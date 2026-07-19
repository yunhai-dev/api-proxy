import { db, schema } from "./db";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { DashboardRange, DashboardStats, LogEntry, LogListEntry } from "./types";
import { usePostgres } from "./db/runtime";
import { modelLookupCandidates } from "./model-variants";
import { getSettings, getSettingsAsync } from "./settings";
import { startOfShanghaiDay } from "./time";
import { applyBillingMultipliers } from "./billing";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const STALE_ACTIVE_MS = 30 * 60 * 1000;
const CHANNEL_HEALTH_CELL_LIMIT = 60;
const DASHBOARD_USER_TOKEN_SERIES_LIMIT = 6;

function rangeStart(range: DashboardRange, now = Date.now()) {
  if (range === "today") return startOfShanghaiDay(now);
  if (range === "7d") return now - 7 * DAY;
  return now - DAY;
}

type DashboardPeriod = DashboardRange | { since: number; until: number };

function resolvePeriod(input: DashboardPeriod, now = Date.now()) {
  if (typeof input === "object") {
    const since = Math.max(0, input.since);
    const until = Math.max(since + 1, input.until);
    return { since, until };
  }
  return { since: rangeStart(input, now), until: now };
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

type BridgeMetricRow = {
  requestDetail: string | null;
  status: number;
  latencyMs: number;
  ttftMs: number;
  durationMs: number;
};

type BridgeDirection = "native" | "openai_to_claude" | "claude_to_openai";

function bridgeDirection(requestDetail: string | null): BridgeDirection | null {
  if (!requestDetail) return null;
  try {
    const detail = JSON.parse(requestDetail) as { protocol?: { direction?: unknown } };
    const direction = detail.protocol?.direction;
    return direction === "native" || direction === "openai_to_claude" || direction === "claude_to_openai"
      ? direction
      : null;
  } catch {
    return null;
  }
}

function reasoningEffortFromDetail(detail: string | null) {
  if (!detail) return undefined;
  try {
    const parsed = JSON.parse(detail) as { reasoning?: { effort?: unknown } };
    return typeof parsed.reasoning?.effort === "string" ? parsed.reasoning.effort : undefined;
  } catch {
    return undefined;
  }
}

export function bridgeObservability(rows: BridgeMetricRow[], totalRequests = rows.length) {
  const groups = new Map<BridgeDirection, BridgeMetricRow[]>([
    ["native", []],
    ["openai_to_claude", []],
    ["claude_to_openai", []],
  ]);
  let unclassifiedRequests = 0;

  for (const row of rows) {
    const direction = bridgeDirection(row.requestDetail);
    if (!direction) {
      unclassifiedRequests += 1;
      continue;
    }
    groups.get(direction)?.push(row);
  }

  const summarize = (items: BridgeMetricRow[]) => {
    const successes = items.filter(row => row.status >= 200 && row.status < 300);
    const ttfts = successes.map(row => row.ttftMs || row.latencyMs).sort((a, b) => a - b);
    const durations = successes.map(row => row.durationMs || row.latencyMs).sort((a, b) => a - b);
    const average = (values: number[]) => values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : 0;
    return {
      requests: items.length,
      successes: successes.length,
      failures: items.length - successes.length,
      compatibilityRejections: items.filter(row => {
        try {
          const detail = JSON.parse(row.requestDetail ?? "{}") as { compatibility_rejection?: unknown };
          return typeof detail.compatibility_rejection === "string" && detail.compatibility_rejection.length > 0;
        } catch {
          return false;
        }
      }).length,
      successRate: items.length ? (successes.length / items.length) * 100 : 100,
      ttftAvgMs: average(ttfts),
      ttftP50Ms: percentile(ttfts, 50),
      durationAvgMs: average(durations),
      durationP50Ms: percentile(durations, 50),
    };
  };

  return {
    observedRequests: rows.length - unclassifiedRequests,
    unclassifiedRequests: totalRequests - (rows.length - unclassifiedRequests),
    native: summarize(groups.get("native") ?? []),
    openaiToClaude: summarize(groups.get("openai_to_claude") ?? []),
    claudeToOpenai: summarize(groups.get("claude_to_openai") ?? []),
  };
}

export function getDashboardStats(period: DashboardPeriod = "24h", opts: { userId?: string } = {}): DashboardStats {
  const now = Date.now();
  cleanupStaleActiveRequests(now);
  const prices = db.select().from(schema.modelPrices).all();
  const priceMap = new Map(prices.map(p => [p.channelId ? `${p.channelId}:${p.model}` : `${p.provider}:${p.model}`, p]));
  const settings = getSettings();
  const costFor = (provider: "claude" | "openai", channelId: string, model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheCreationTokens = 0) => applyBillingMultipliers(logCost(provider, channelId, model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, priceMap), provider, settings);
  const { since, until } = resolvePeriod(period, now);
  const periodMs = Math.max(1, until - since);
  const prevSince = since - periodMs;
  const ownerWhere = opts.userId ? eq(schema.keys.userId, opts.userId) : undefined;

  const rangeRows = db
    .select({
      id: schema.requestLogs.id,
      requestId: schema.requestLogs.requestId,
      ts: schema.requestLogs.ts,
      status: schema.requestLogs.status,
      latencyMs: schema.requestLogs.latencyMs,
      ttftMs: schema.requestLogs.ttftMs,
      durationMs: schema.requestLogs.durationMs,
      model: schema.requestLogs.model,
      tokensIn: schema.requestLogs.tokensIn,
      tokensOut: schema.requestLogs.tokensOut,
      cacheTokens: schema.requestLogs.cacheTokens,
      cacheReadTokens: schema.requestLogs.cacheReadTokens,
      cacheCreationTokens: schema.requestLogs.cacheCreationTokens,
      requestDetail: schema.requestLogs.requestDetail,
      channelId: schema.channels.id,
      channelName: schema.channels.name,
      channelType: schema.channels.type,
      keyId: schema.keys.id,
      keyName: schema.keys.name,
      keyPrefix: schema.keys.prefix,
      keyUserId: schema.keys.userId,
      userDisplayName: schema.users.displayName,
      username: schema.users.username,
      keyLastUsedAt: schema.keys.lastUsedAt,
    })
    .from(schema.requestLogs)
    .leftJoin(schema.channels, eq(schema.channels.id, schema.requestLogs.channelId))
    .leftJoin(schema.keys, eq(schema.keys.id, schema.requestLogs.keyId))
    .leftJoin(schema.users, eq(schema.users.id, schema.keys.userId))
    .where(ownerWhere ? and(gte(schema.requestLogs.ts, since), lt(schema.requestLogs.ts, until), ownerWhere) : and(gte(schema.requestLogs.ts, since), lt(schema.requestLogs.ts, until)))
    .all();

  const prevRows = db
    .select({ id: schema.requestLogs.id })
    .from(schema.requestLogs)
    .leftJoin(schema.keys, eq(schema.keys.id, schema.requestLogs.keyId))
    .where(ownerWhere ? and(gte(schema.requestLogs.ts, prevSince), lt(schema.requestLogs.ts, since), ownerWhere) : and(gte(schema.requestLogs.ts, prevSince), lt(schema.requestLogs.ts, since)))
    .all();
  const activeConversations = db
    .select({ id: schema.requestLogs.id })
    .from(schema.requestLogs)
    .leftJoin(schema.keys, eq(schema.keys.id, schema.requestLogs.keyId))
    .where(ownerWhere ? and(eq(schema.requestLogs.durationMs, 0), gte(schema.requestLogs.ts, now - STALE_ACTIVE_MS), ownerWhere) : and(eq(schema.requestLogs.durationMs, 0), gte(schema.requestLogs.ts, now - STALE_ACTIVE_MS)))
    .all().length;

  const requests24h = rangeRows.length;
  const success24h = rangeRows.filter(r => r.status >= 200 && r.status < 300).length;
  const requestsYesterday = prevRows.length;
  const requestsDelta = requestsYesterday > 0
    ? ((requests24h - requestsYesterday) / requestsYesterday) * 100
    : 0;

  const successRate = requests24h > 0 ? (success24h / requests24h) * 100 : 100;
  // 简化：成功率的昨天差视为 ±0.3
  const successDelta = -0.3;

  const p50Rows = rangeRows
    .filter(r => r.status >= 200 && r.status < 300)
    .map(r => r.latencyMs)
    .sort((a, b) => a - b);
  const p50 = p50Rows.length ? p50Rows[Math.floor(p50Rows.length / 2)] : 0;
  const p50Delta = -44;

  const totalTokensIn = rangeRows.reduce((s, r) => s + r.tokensIn, 0);
  const totalTokensOut = rangeRows.reduce((s, r) => s + r.tokensOut, 0);
  const totalCacheReadTokens = rangeRows.reduce((s, r) => s + r.cacheReadTokens, 0);
  const totalCacheCreationTokens = rangeRows.reduce((s, r) => s + r.cacheCreationTokens, 0);
  const totalCacheTokens = totalCacheReadTokens + totalCacheCreationTokens;
  const tokensIn = totalTokensIn / 1_000_000;
  const tokensOut = totalTokensOut / 1_000_000;
  const cacheTokens = totalCacheTokens / 1_000_000;
  const cacheReadTokens = totalCacheReadTokens / 1_000_000;
  const cacheCreationTokens = totalCacheCreationTokens / 1_000_000;

  const cost = rangeRows.reduce((sum, row) => sum + costFor(row.channelType, row.channelId ?? "", row.model, row.tokensIn, row.tokensOut, row.cacheReadTokens, row.cacheCreationTokens), 0);
  const totalPromptTokens = tokensIn + cacheReadTokens + cacheCreationTokens;
  const cacheHit = totalPromptTokens > 0 ? (cacheReadTokens / totalPromptTokens) * 100 : 0;
  const seconds = Math.max(1, periodMs / 1000);
  const successRows = rangeRows.filter(r => r.status >= 200 && r.status < 300);
  const ttftsGlobal = successRows.map(r => r.ttftMs || r.latencyMs).sort((a, b) => a - b);
  const durationsGlobal = successRows.map(r => r.durationMs || r.latencyMs).sort((a, b) => a - b);
  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0;
  const globalPerf = {
    qps: requests24h / seconds,
    tps: (totalTokensIn + totalTokensOut + totalCacheReadTokens + totalCacheCreationTokens) / seconds,
    ttftAvgMs: avg(ttftsGlobal),
    ttftP50Ms: percentile(ttftsGlobal, 50),
    ttftP90Ms: percentile(ttftsGlobal, 90),
    ttftP95Ms: percentile(ttftsGlobal, 95),
    ttftMaxMs: ttftsGlobal.length ? ttftsGlobal[ttftsGlobal.length - 1] : 0,
    durationAvgMs: avg(durationsGlobal),
    durationP50Ms: percentile(durationsGlobal, 50),
    durationP90Ms: percentile(durationsGlobal, 90),
    durationP95Ms: percentile(durationsGlobal, 95),
    durationMaxMs: durationsGlobal.length ? durationsGlobal[durationsGlobal.length - 1] : 0,
  };

  const bucketCount = 24;
  const bucketMs = Math.max(1, periodMs / bucketCount);
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    ts: Math.round(since + i * bucketMs),
    requests: 0,
    tokens: 0,
  }));
  for (const row of rangeRows) {
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((row.ts - since) / bucketMs)));
    buckets[idx].requests += 1;
    buckets[idx].tokens += row.tokensIn + row.tokensOut + row.cacheReadTokens + row.cacheCreationTokens;
  }
  const bucketSeconds = Math.max(1, bucketMs / 1000);
  const throughputSeries = buckets.map(b => ({
    ts: b.ts,
    qps: b.requests / bucketSeconds,
    tps: b.tokens / bucketSeconds,
  }));

  const trafficMap = new Map<string, { id: string; name: string; type: "claude" | "openai"; n: number }>();
  for (const row of rangeRows) {
    const channelId = row.channelId ?? "missing-channel";
    const channelType = row.channelType;
    const cur = trafficMap.get(channelId) ?? { id: channelId, name: row.channelName ?? "未选择", type: channelType, n: 0 };
    cur.n += 1;
    trafficMap.set(channelId, cur);
  }
  const traffic = [...trafficMap.values()].sort((a, b) => b.n - a.n);

  const keyMap = new Map<string, {
    id: string; name: string; prefix: string; last: number;
    requests: number; tokensIn: number; tokensOut: number; cacheTokens: number; cacheReadTokens: number; cacheCreationTokens: number;
  }>();
  const userMap = new Map<string, {
    id: string; name: string; username: string; last: number;
    requests: number; tokensIn: number; tokensOut: number; cacheTokens: number; cacheReadTokens: number; cacheCreationTokens: number; cost: number;
  }>();
  for (const row of rangeRows) {
    const keyId = row.keyId ?? "missing-key";
    const userId = row.keyUserId || "unknown-user";
    const rowCost = costFor(row.channelType, row.channelId ?? "", row.model, row.tokensIn, row.tokensOut, row.cacheReadTokens, row.cacheCreationTokens);
    const cur = keyMap.get(keyId) ?? {
      id: keyId, name: row.keyName ?? "未认证", prefix: row.keyPrefix ?? "—", last: row.keyLastUsedAt ?? 0,
      requests: 0, tokensIn: 0, tokensOut: 0, cacheTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    };
    cur.requests += 1;
    cur.tokensIn += row.tokensIn;
    cur.tokensOut += row.tokensOut;
    cur.cacheReadTokens += row.cacheReadTokens;
    cur.cacheCreationTokens += row.cacheCreationTokens;
    cur.cacheTokens += row.cacheReadTokens + row.cacheCreationTokens;
    keyMap.set(keyId, cur);
    const user = userMap.get(userId) ?? {
      id: userId, name: row.userDisplayName || row.username || "未知用户", username: row.username || "—", last: 0,
      requests: 0, tokensIn: 0, tokensOut: 0, cacheTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, cost: 0,
    };
    user.requests += 1;
    user.tokensIn += row.tokensIn;
    user.tokensOut += row.tokensOut;
    user.cacheReadTokens += row.cacheReadTokens;
    user.cacheCreationTokens += row.cacheCreationTokens;
    user.cacheTokens += row.cacheReadTokens + row.cacheCreationTokens;
    user.cost += rowCost;
    user.last = Math.max(user.last, row.ts);
    userMap.set(userId, user);
  }
  const topKeys = [...keyMap.values()]
    .map(k => ({
      ...k,
      totalTokens: k.tokensIn + k.tokensOut + k.cacheReadTokens + k.cacheCreationTokens,
      cost: rangeRows.filter(row => (row.keyId ?? "missing-key") === k.id).reduce((sum, row) => sum + costFor(row.channelType, row.channelId ?? "", row.model, row.tokensIn, row.tokensOut, row.cacheReadTokens, row.cacheCreationTokens), 0),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 6);
  const topUsers = [...userMap.values()]
    .map(u => ({ ...u, totalTokens: u.tokensIn + u.tokensOut + u.cacheReadTokens + u.cacheCreationTokens }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 6);

  const modelMap = new Map<string, {
    provider: "claude" | "openai";
    model: string;
    requests: number;
    success: number;
    latencies: number[];
    ttfts: number[];
    durations: number[];
    tokensIn: number;
    tokensOut: number;
    cacheTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    cost: number;
  }>();
  for (const row of rangeRows) {
    const channelType = row.channelType;
    const key = `${channelType}:${row.model}`;
    const cur = modelMap.get(key) ?? {
      provider: channelType,
      model: row.model,
      requests: 0,
      success: 0,
      latencies: [] as number[],
      ttfts: [] as number[],
      durations: [] as number[],
      tokensIn: 0,
      tokensOut: 0,
      cacheTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cost: 0,
    };
    cur.requests += 1;
    if (row.status >= 200 && row.status < 300) {
      cur.success += 1;
      cur.latencies.push(row.latencyMs);
      cur.ttfts.push(row.ttftMs || row.latencyMs);
      cur.durations.push(row.durationMs || row.latencyMs);
    }
    cur.tokensIn += row.tokensIn;
    cur.tokensOut += row.tokensOut;
    cur.cacheReadTokens += row.cacheReadTokens;
    cur.cacheCreationTokens += row.cacheCreationTokens;
    cur.cacheTokens += row.cacheReadTokens + row.cacheCreationTokens;
    cur.cost += costFor(channelType, row.channelId ?? "", row.model, row.tokensIn, row.tokensOut, row.cacheReadTokens, row.cacheCreationTokens);
    modelMap.set(key, cur);
  }

  const modelStats = [...modelMap.values()]
    .map(m => {
      const totalTokens = m.tokensIn + m.tokensOut + m.cacheReadTokens + m.cacheCreationTokens;
      return {
        provider: m.provider,
        model: m.model,
        requests: m.requests,
        tokensIn: m.tokensIn,
        tokensOut: m.tokensOut,
        cacheTokens: m.cacheTokens,
        cacheReadTokens: m.cacheReadTokens,
        cacheCreationTokens: m.cacheCreationTokens,
        totalTokens,
        cost: m.cost,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 8);

  const userTokenTotals = new Map<string, { id: string; name: string; totalTokens: number }>();
  for (const row of rangeRows) {
    const id = row.keyUserId || "unknown-user";
    const name = row.userDisplayName || row.username || "未知用户";
    const cur = userTokenTotals.get(id) ?? { id, name, totalTokens: 0 };
    cur.totalTokens += row.tokensIn + row.tokensOut + row.cacheReadTokens + row.cacheCreationTokens;
    userTokenTotals.set(id, cur);
  }
  const userTokenUsers = [...userTokenTotals.values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, DASHBOARD_USER_TOKEN_SERIES_LIMIT);
  const userTokenIds = new Set(userTokenUsers.map(user => user.id));
  const userTokenSeries = buckets.map(bucket => ({ ts: bucket.ts } as { ts: number } & Record<string, number>));
  for (const row of rangeRows) {
    const id = row.keyUserId || "unknown-user";
    if (!userTokenIds.has(id)) continue;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((row.ts - since) / bucketMs)));
    userTokenSeries[idx][id] = (userTokenSeries[idx][id] ?? 0) + row.tokensIn + row.tokensOut + row.cacheReadTokens + row.cacheCreationTokens;
  }

  return {
    requests24h,
    activeConversations,
    requestsDelta,
    successRate,
    successDelta,
    p50,
    p50Delta,
    tokensIn,
    tokensOut,
    cost,
    cacheHit,
    cacheTokens,
    cacheReadTokens,
    cacheCreationTokens,
    globalPerf,
    bridgeObservability: bridgeObservability(rangeRows),
    throughputSeries,
    trafficByChannel: traffic,
    topKeys,
    topUsers,
    modelStats,
    userTokenUsers,
    userTokenSeries,
  };
}

function cleanupStaleActiveRequests(now: number) {
  const stale = db
    .select({ id: schema.requestLogs.id, ts: schema.requestLogs.ts })
    .from(schema.requestLogs)
    .where(and(eq(schema.requestLogs.durationMs, 0), lt(schema.requestLogs.ts, now - STALE_ACTIVE_MS)))
    .all();
  for (const row of stale) {
    const duration = Math.max(1, now - row.ts);
    db.update(schema.requestLogs)
      .set({ status: 499, latencyMs: duration, ttftMs: duration, durationMs: duration, errorMsg: "客户端取消/连接中断：活跃请求超时清理" })
      .where(eq(schema.requestLogs.id, row.id))
      .run();
  }
}

async function cleanupStaleActiveRequestsAsync(now: number) {
  if (!usePostgres()) return cleanupStaleActiveRequests(now);
  const { pgDb, pgSchema } = await import("./db/pg");
  const stale = await pgDb
    .select({ id: pgSchema.requestLogs.id, ts: pgSchema.requestLogs.ts })
    .from(pgSchema.requestLogs)
    .where(and(eq(pgSchema.requestLogs.durationMs, 0), lt(pgSchema.requestLogs.ts, now - STALE_ACTIVE_MS)));
  for (const row of stale) {
    const duration = Math.max(1, now - row.ts);
    await pgDb.update(pgSchema.requestLogs)
      .set({ status: 499, latencyMs: duration, ttftMs: duration, durationMs: duration, errorMsg: "客户端取消/连接中断：活跃请求超时清理" })
      .where(eq(pgSchema.requestLogs.id, row.id));
  }
}

export async function getDashboardStatsAsync(period: DashboardPeriod = "24h", opts: { userId?: string } = {}): Promise<DashboardStats> {
  if (!usePostgres()) return getDashboardStats(period, opts);
  const now = Date.now();
  await cleanupStaleActiveRequestsAsync(now);
  const { pgDb, pgSchema } = await import("./db/pg");
  const prices = await pgDb.select().from(pgSchema.modelPrices);
  const priceMap = new Map(prices.map(p => [p.channelId ? `${p.channelId}:${p.model}` : `${p.provider}:${p.model}`, p]));
  const settings = await getSettingsAsync();
  const costFor = (provider: "claude" | "openai", channelId: string, model: string, inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheCreationTokens = 0) => applyBillingMultipliers(logCost(provider, channelId, model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, priceMap), provider, settings);
  const { since, until } = resolvePeriod(period, now);
  const periodMs = Math.max(1, until - since);
  const prevSince = since - periodMs;
  const ownerWhere = opts.userId ? eq(pgSchema.requestStats.userId, opts.userId) : undefined;

  const rangeWhere = ownerWhere ? and(gte(pgSchema.requestStats.ts, since), lt(pgSchema.requestStats.ts, until), ownerWhere) : and(gte(pgSchema.requestStats.ts, since), lt(pgSchema.requestStats.ts, until));
  const prevWhere = ownerWhere ? and(gte(pgSchema.requestStats.ts, prevSince), lt(pgSchema.requestStats.ts, since), ownerWhere) : and(gte(pgSchema.requestStats.ts, prevSince), lt(pgSchema.requestStats.ts, since));

  const totalTokensSql = sql<number>`coalesce(sum(${pgSchema.requestStats.tokensIn} + ${pgSchema.requestStats.tokensOut} + ${pgSchema.requestStats.cacheReadTokens} + ${pgSchema.requestStats.cacheCreationTokens}), 0)::double precision`;
  const successFilter = sql`${pgSchema.requestStats.status} >= 200 and ${pgSchema.requestStats.status} < 300`;
  const [summary] = await pgDb
    .select({
      requests: sql<number>`count(*)::int`,
      successes: sql<number>`sum(case when ${successFilter} then 1 else 0 end)::int`,
      tokensIn: sql<number>`coalesce(sum(${pgSchema.requestStats.tokensIn}), 0)::double precision`,
      tokensOut: sql<number>`coalesce(sum(${pgSchema.requestStats.tokensOut}), 0)::double precision`,
      cacheReadTokens: sql<number>`coalesce(sum(${pgSchema.requestStats.cacheReadTokens}), 0)::double precision`,
      cacheCreationTokens: sql<number>`coalesce(sum(${pgSchema.requestStats.cacheCreationTokens}), 0)::double precision`,
      p50: sql<number>`coalesce(percentile_disc(0.5) within group (order by ${pgSchema.requestStats.latencyMs}) filter (where ${successFilter}), 0)::double precision`,
      ttftAvgMs: sql<number>`coalesce(round(avg(coalesce(nullif(${pgSchema.requestStats.ttftMs}, 0), ${pgSchema.requestStats.latencyMs})) filter (where ${successFilter})), 0)::double precision`,
      ttftP50Ms: sql<number>`coalesce(percentile_disc(0.5) within group (order by coalesce(nullif(${pgSchema.requestStats.ttftMs}, 0), ${pgSchema.requestStats.latencyMs})) filter (where ${successFilter}), 0)::double precision`,
      ttftP90Ms: sql<number>`coalesce(percentile_disc(0.9) within group (order by coalesce(nullif(${pgSchema.requestStats.ttftMs}, 0), ${pgSchema.requestStats.latencyMs})) filter (where ${successFilter}), 0)::double precision`,
      ttftP95Ms: sql<number>`coalesce(percentile_disc(0.95) within group (order by coalesce(nullif(${pgSchema.requestStats.ttftMs}, 0), ${pgSchema.requestStats.latencyMs})) filter (where ${successFilter}), 0)::double precision`,
      ttftMaxMs: sql<number>`coalesce(max(coalesce(nullif(${pgSchema.requestStats.ttftMs}, 0), ${pgSchema.requestStats.latencyMs})) filter (where ${successFilter}), 0)::double precision`,
      durationAvgMs: sql<number>`coalesce(round(avg(coalesce(nullif(${pgSchema.requestStats.durationMs}, 0), ${pgSchema.requestStats.latencyMs})) filter (where ${successFilter})), 0)::double precision`,
      durationP50Ms: sql<number>`coalesce(percentile_disc(0.5) within group (order by coalesce(nullif(${pgSchema.requestStats.durationMs}, 0), ${pgSchema.requestStats.latencyMs})) filter (where ${successFilter}), 0)::double precision`,
      durationP90Ms: sql<number>`coalesce(percentile_disc(0.9) within group (order by coalesce(nullif(${pgSchema.requestStats.durationMs}, 0), ${pgSchema.requestStats.latencyMs})) filter (where ${successFilter}), 0)::double precision`,
      durationP95Ms: sql<number>`coalesce(percentile_disc(0.95) within group (order by coalesce(nullif(${pgSchema.requestStats.durationMs}, 0), ${pgSchema.requestStats.latencyMs})) filter (where ${successFilter}), 0)::double precision`,
      durationMaxMs: sql<number>`coalesce(max(coalesce(nullif(${pgSchema.requestStats.durationMs}, 0), ${pgSchema.requestStats.latencyMs})) filter (where ${successFilter}), 0)::double precision`,
    })
    .from(pgSchema.requestStats)
    .where(rangeWhere);
  const [prevSummary] = await pgDb.select({ requests: sql<number>`count(*)::int` }).from(pgSchema.requestStats).where(prevWhere);
  const [activeSummary] = await pgDb
    .select({ requests: sql<number>`count(*)::int` })
    .from(pgSchema.requestLogs)
    .leftJoin(pgSchema.keys, eq(pgSchema.keys.id, pgSchema.requestLogs.keyId))
    .where(opts.userId ? and(eq(pgSchema.requestLogs.durationMs, 0), gte(pgSchema.requestLogs.ts, now - STALE_ACTIVE_MS), eq(pgSchema.keys.userId, opts.userId)) : and(eq(pgSchema.requestLogs.durationMs, 0), gte(pgSchema.requestLogs.ts, now - STALE_ACTIVE_MS)));

  const requests24h = summary?.requests ?? 0;
  const success24h = summary?.successes ?? 0;
  const requestsYesterday = prevSummary?.requests ?? 0;
  const requestsDelta = requestsYesterday > 0 ? ((requests24h - requestsYesterday) / requestsYesterday) * 100 : 0;
  const successRate = requests24h > 0 ? (success24h / requests24h) * 100 : 100;
  const totalTokensIn = summary?.tokensIn ?? 0;
  const totalTokensOut = summary?.tokensOut ?? 0;
  const totalCacheReadTokens = summary?.cacheReadTokens ?? 0;
  const totalCacheCreationTokens = summary?.cacheCreationTokens ?? 0;
  const tokensIn = totalTokensIn / 1_000_000;
  const tokensOut = totalTokensOut / 1_000_000;
  const cacheReadTokens = totalCacheReadTokens / 1_000_000;
  const cacheCreationTokens = totalCacheCreationTokens / 1_000_000;
  const cacheTokens = cacheReadTokens + cacheCreationTokens;
  const totalPromptTokens = tokensIn + cacheReadTokens + cacheCreationTokens;
  const cacheHit = totalPromptTokens > 0 ? (cacheReadTokens / totalPromptTokens) * 100 : 0;
  const seconds = Math.max(1, periodMs / 1000);
  const globalPerf = {
    qps: requests24h / seconds,
    tps: (totalTokensIn + totalTokensOut + totalCacheReadTokens + totalCacheCreationTokens) / seconds,
    ttftAvgMs: summary?.ttftAvgMs ?? 0,
    ttftP50Ms: summary?.ttftP50Ms ?? 0,
    ttftP90Ms: summary?.ttftP90Ms ?? 0,
    ttftP95Ms: summary?.ttftP95Ms ?? 0,
    ttftMaxMs: summary?.ttftMaxMs ?? 0,
    durationAvgMs: summary?.durationAvgMs ?? 0,
    durationP50Ms: summary?.durationP50Ms ?? 0,
    durationP90Ms: summary?.durationP90Ms ?? 0,
    durationP95Ms: summary?.durationP95Ms ?? 0,
    durationMaxMs: summary?.durationMaxMs ?? 0,
  };

  const bucketCount = 24;
  const bucketMs = Math.max(1, Math.round(periodMs / bucketCount));
  const bucketExpr = sql<number>`floor((${pgSchema.requestStats.ts} - ${since}) / ${bucketMs})::int`.as("bucket");
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({ ts: Math.round(since + i * bucketMs), requests: 0, tokens: 0 }));
  const bucketedRows = pgDb
    .select({
      bucket: bucketExpr,
      tokensIn: pgSchema.requestStats.tokensIn,
      tokensOut: pgSchema.requestStats.tokensOut,
      cacheReadTokens: pgSchema.requestStats.cacheReadTokens,
      cacheCreationTokens: pgSchema.requestStats.cacheCreationTokens,
    })
    .from(pgSchema.requestStats)
    .where(rangeWhere)
    .as("bucketed_rows");
  const bucketRows = await pgDb
    .select({
      bucket: bucketedRows.bucket,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${bucketedRows.tokensIn} + ${bucketedRows.tokensOut} + ${bucketedRows.cacheReadTokens} + ${bucketedRows.cacheCreationTokens}), 0)::double precision`,
    })
    .from(bucketedRows)
    .groupBy(bucketedRows.bucket);
  for (const row of bucketRows) {
    const idx = Math.min(bucketCount - 1, Math.max(0, row.bucket));
    buckets[idx].requests = row.requests;
    buckets[idx].tokens = row.tokens;
  }
  const bucketSeconds = Math.max(1, bucketMs / 1000);
  const throughputSeries = buckets.map(b => ({ ts: b.ts, qps: b.requests / bucketSeconds, tps: b.tokens / bucketSeconds }));

  const channelTypeExpr = sql<"claude" | "openai">`coalesce(${pgSchema.channels.type}, ${pgSchema.requestStats.channelType})`;
  const trafficByChannel = await pgDb
    .select({ id: pgSchema.requestStats.channelId, name: sql<string>`coalesce(${pgSchema.channels.name}, '未选择')`, type: channelTypeExpr, n: sql<number>`count(*)::int` })
    .from(pgSchema.requestStats)
    .leftJoin(pgSchema.channels, eq(pgSchema.channels.id, pgSchema.requestStats.channelId))
    .where(rangeWhere)
    .groupBy(pgSchema.requestStats.channelId, pgSchema.channels.name, channelTypeExpr)
    .orderBy(sql`count(*) desc`);

  const keyRows = await pgDb
    .select({
      id: pgSchema.requestStats.keyId,
      name: sql<string>`coalesce(${pgSchema.keys.name}, '未认证')`,
      prefix: sql<string>`coalesce(${pgSchema.keys.prefix}, '—')`,
      last: sql<number>`coalesce(max(${pgSchema.keys.lastUsedAt}), 0)::double precision`,
      provider: channelTypeExpr,
      channelId: pgSchema.requestStats.channelId,
      model: pgSchema.requestStats.model,
      requests: sql<number>`count(*)::int`,
      tokensIn: sql<number>`coalesce(sum(${pgSchema.requestStats.tokensIn}), 0)::double precision`,
      tokensOut: sql<number>`coalesce(sum(${pgSchema.requestStats.tokensOut}), 0)::double precision`,
      cacheReadTokens: sql<number>`coalesce(sum(${pgSchema.requestStats.cacheReadTokens}), 0)::double precision`,
      cacheCreationTokens: sql<number>`coalesce(sum(${pgSchema.requestStats.cacheCreationTokens}), 0)::double precision`,
      totalTokens: totalTokensSql,
    })
    .from(pgSchema.requestStats)
    .leftJoin(pgSchema.channels, eq(pgSchema.channels.id, pgSchema.requestStats.channelId))
    .leftJoin(pgSchema.keys, eq(pgSchema.keys.id, pgSchema.requestStats.keyId))
    .where(rangeWhere)
    .groupBy(pgSchema.requestStats.keyId, pgSchema.keys.name, pgSchema.keys.prefix, channelTypeExpr, pgSchema.requestStats.channelId, pgSchema.requestStats.model);
  const keyMap = new Map<string, { id: string; name: string; prefix: string; last: number; requests: number; tokensIn: number; tokensOut: number; cacheTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; cost: number }>();
  for (const row of keyRows) {
    const key = keyMap.get(row.id) ?? { id: row.id, name: row.name, prefix: row.prefix, last: row.last ?? 0, requests: 0, tokensIn: 0, tokensOut: 0, cacheTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, cost: 0 };
    key.requests += row.requests;
    key.tokensIn += row.tokensIn;
    key.tokensOut += row.tokensOut;
    key.cacheReadTokens += row.cacheReadTokens;
    key.cacheCreationTokens += row.cacheCreationTokens;
    key.cacheTokens += row.cacheReadTokens + row.cacheCreationTokens;
    key.totalTokens += row.totalTokens;
    key.cost += costFor(row.provider, row.channelId ?? "", row.model, row.tokensIn, row.tokensOut, row.cacheReadTokens, row.cacheCreationTokens);
    keyMap.set(row.id, key);
  }
  const topKeys = [...keyMap.values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 6);

  const userRows = await pgDb
    .select({
      id: pgSchema.requestStats.userId,
      name: sql<string>`coalesce(nullif(${pgSchema.users.displayName}, ''), nullif(${pgSchema.users.username}, ''), '未知用户')`,
      username: sql<string>`coalesce(nullif(${pgSchema.users.username}, ''), '—')`,
      last: sql<number>`coalesce(max(${pgSchema.requestStats.ts}), 0)::bigint`,
      provider: channelTypeExpr,
      channelId: pgSchema.requestStats.channelId,
      model: pgSchema.requestStats.model,
      requests: sql<number>`count(*)::int`,
      tokensIn: sql<number>`coalesce(sum(${pgSchema.requestStats.tokensIn}), 0)::double precision`,
      tokensOut: sql<number>`coalesce(sum(${pgSchema.requestStats.tokensOut}), 0)::double precision`,
      cacheReadTokens: sql<number>`coalesce(sum(${pgSchema.requestStats.cacheReadTokens}), 0)::double precision`,
      cacheCreationTokens: sql<number>`coalesce(sum(${pgSchema.requestStats.cacheCreationTokens}), 0)::double precision`,
      totalTokens: totalTokensSql,
    })
    .from(pgSchema.requestStats)
    .leftJoin(pgSchema.channels, eq(pgSchema.channels.id, pgSchema.requestStats.channelId))
    .leftJoin(pgSchema.users, eq(pgSchema.users.id, pgSchema.requestStats.userId))
    .where(rangeWhere)
    .groupBy(pgSchema.requestStats.userId, pgSchema.users.displayName, pgSchema.users.username, channelTypeExpr, pgSchema.requestStats.channelId, pgSchema.requestStats.model);
  const userMap = new Map<string, { id: string; name: string; username: string; last: number; requests: number; tokensIn: number; tokensOut: number; cacheTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; cost: number }>();
  for (const row of userRows) {
    const user = userMap.get(row.id) ?? { id: row.id, name: row.name, username: row.username, last: 0, requests: 0, tokensIn: 0, tokensOut: 0, cacheTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, cost: 0 };
    user.requests += row.requests;
    user.tokensIn += row.tokensIn;
    user.tokensOut += row.tokensOut;
    user.cacheReadTokens += row.cacheReadTokens;
    user.cacheCreationTokens += row.cacheCreationTokens;
    user.cacheTokens += row.cacheReadTokens + row.cacheCreationTokens;
    user.totalTokens += row.totalTokens;
    user.cost += costFor(row.provider, row.channelId ?? "", row.model, row.tokensIn, row.tokensOut, row.cacheReadTokens, row.cacheCreationTokens);
    user.last = Math.max(user.last, row.last ?? 0);
    userMap.set(row.id, user);
  }
  const topUsers = [...userMap.values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 6);

  const modelRows = await pgDb
    .select({
      provider: channelTypeExpr,
      channelId: pgSchema.requestStats.channelId,
      model: pgSchema.requestStats.model,
      requests: sql<number>`count(*)::int`,
      tokensIn: sql<number>`coalesce(sum(${pgSchema.requestStats.tokensIn}), 0)::double precision`,
      tokensOut: sql<number>`coalesce(sum(${pgSchema.requestStats.tokensOut}), 0)::double precision`,
      cacheReadTokens: sql<number>`coalesce(sum(${pgSchema.requestStats.cacheReadTokens}), 0)::double precision`,
      cacheCreationTokens: sql<number>`coalesce(sum(${pgSchema.requestStats.cacheCreationTokens}), 0)::double precision`,
      totalTokens: totalTokensSql,
    })
    .from(pgSchema.requestStats)
    .leftJoin(pgSchema.channels, eq(pgSchema.channels.id, pgSchema.requestStats.channelId))
    .where(rangeWhere)
    .groupBy(channelTypeExpr, pgSchema.requestStats.channelId, pgSchema.requestStats.model);
  const modelMap = new Map<string, { provider: "claude" | "openai"; model: string; requests: number; tokensIn: number; tokensOut: number; cacheTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; cost: number }>();
  for (const row of modelRows) {
    const key = `${row.provider}:${row.model}`;
    const model = modelMap.get(key) ?? { provider: row.provider, model: row.model, requests: 0, tokensIn: 0, tokensOut: 0, cacheTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, cost: 0 };
    model.requests += row.requests;
    model.tokensIn += row.tokensIn;
    model.tokensOut += row.tokensOut;
    model.cacheReadTokens += row.cacheReadTokens;
    model.cacheCreationTokens += row.cacheCreationTokens;
    model.cacheTokens += row.cacheReadTokens + row.cacheCreationTokens;
    model.totalTokens += row.totalTokens;
    model.cost += costFor(row.provider, row.channelId ?? "", row.model, row.tokensIn, row.tokensOut, row.cacheReadTokens, row.cacheCreationTokens);
    modelMap.set(key, model);
  }
  const modelStats = [...modelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 8);
  const cost = [...modelMap.values()].reduce((sum, row) => sum + row.cost, 0);

  const userTokenUsers = topUsers.map(user => ({ id: user.id, name: user.name, totalTokens: user.totalTokens }));
  const userTokenIds = userTokenUsers.map(user => user.id);
  const userTokenSeries = buckets.map(bucket => ({ ts: bucket.ts } as { ts: number } & Record<string, number>));
  if (userTokenIds.length > 0) {
    const userBucketedRows = pgDb
      .select({
        userId: pgSchema.requestStats.userId,
        bucket: bucketExpr,
        tokensIn: pgSchema.requestStats.tokensIn,
        tokensOut: pgSchema.requestStats.tokensOut,
        cacheReadTokens: pgSchema.requestStats.cacheReadTokens,
        cacheCreationTokens: pgSchema.requestStats.cacheCreationTokens,
      })
      .from(pgSchema.requestStats)
      .where(and(rangeWhere, inArray(pgSchema.requestStats.userId, userTokenIds)))
      .as("user_token_bucketed_rows");
    const userBucketRows = await pgDb
      .select({
        userId: userBucketedRows.userId,
        bucket: userBucketedRows.bucket,
        tokens: sql<number>`coalesce(sum(${userBucketedRows.tokensIn} + ${userBucketedRows.tokensOut} + ${userBucketedRows.cacheReadTokens} + ${userBucketedRows.cacheCreationTokens}), 0)::double precision`,
      })
      .from(userBucketedRows)
      .groupBy(userBucketedRows.userId, userBucketedRows.bucket);
    for (const row of userBucketRows) {
      const idx = Math.min(bucketCount - 1, Math.max(0, row.bucket));
      userTokenSeries[idx][row.userId] = row.tokens;
    }
  }

  const detailRows = await pgDb
    .select({
      rawLogId: pgSchema.requestLogs.id,
      requestDetail: pgSchema.requestLogs.requestDetail,
      status: pgSchema.requestLogs.status,
      latencyMs: pgSchema.requestLogs.latencyMs,
      ttftMs: pgSchema.requestLogs.ttftMs,
      durationMs: pgSchema.requestLogs.durationMs,
    })
    .from(pgSchema.requestLogs)
    .leftJoin(pgSchema.keys, eq(pgSchema.keys.id, pgSchema.requestLogs.keyId))
    .where(opts.userId
      ? and(gte(pgSchema.requestLogs.ts, since), lt(pgSchema.requestLogs.ts, until), eq(pgSchema.keys.userId, opts.userId))
      : and(gte(pgSchema.requestLogs.ts, since), lt(pgSchema.requestLogs.ts, until)));
  const bridgeMetrics = bridgeObservability(detailRows, requests24h);

  return { requests24h, activeConversations: activeSummary?.requests ?? 0, requestsDelta, successRate, successDelta: -0.3, p50: summary?.p50 ?? 0, p50Delta: -44, tokensIn, tokensOut, cost, cacheHit, cacheTokens, cacheReadTokens, cacheCreationTokens, globalPerf, bridgeObservability: bridgeMetrics, throughputSeries, trafficByChannel: trafficByChannel.map(row => ({ id: row.id, name: row.name, type: row.type, n: row.n })), topKeys, topUsers, modelStats, userTokenUsers, userTokenSeries };
}

export function getRecentActivity(limit = 10) {
  return db
    .select()
    .from(schema.activities)
    .orderBy(desc(schema.activities.ts))
    .limit(limit)
    .all();
}

export async function getRecentActivityAsync(limit = 10) {
  if (!usePostgres()) return getRecentActivity(limit);
  const { pgDb, pgSchema } = await import("./db/pg");
  return pgDb.select().from(pgSchema.activities).orderBy(desc(pgSchema.activities.ts)).limit(limit);
}

export function getChannelHealth(period?: { since: number; until: number }) {
  const channels = db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.enabled, true), gte(schema.channels.monitorIntervalSec, 1)))
    .orderBy(schema.channels.name)
    .all();

  if (!period) return channels.map(c => ({ ...c, testLogs: [], totalTests: 0, okTests: 0 }));

  const summaries = db
    .select({
      channelId: schema.channelTestLogs.channelId,
      totalTests: sql<number>`count(*)::int`,
      okTests: sql<number>`sum(case when ${schema.channelTestLogs.ok} then 1 else 0 end)::int`,
    })
    .from(schema.channelTestLogs)
    .where(and(gte(schema.channelTestLogs.ts, period.since), lt(schema.channelTestLogs.ts, period.until)))
    .groupBy(schema.channelTestLogs.channelId)
    .all();
  const summaryByChannel = new Map(summaries.map(row => [row.channelId, row]));
  const recentLogs = new Map<string, (typeof schema.channelTestLogs.$inferSelect)[]>();
  for (const channel of channels) {
    recentLogs.set(channel.id, db
      .select()
      .from(schema.channelTestLogs)
      .where(and(eq(schema.channelTestLogs.channelId, channel.id), gte(schema.channelTestLogs.ts, period.since), lt(schema.channelTestLogs.ts, period.until)))
      .orderBy(desc(schema.channelTestLogs.ts))
      .limit(CHANNEL_HEALTH_CELL_LIMIT)
      .all()
      .reverse());
  }

  return channels.map(c => {
    const summary = summaryByChannel.get(c.id);
    return { ...c, testLogs: recentLogs.get(c.id) ?? [], totalTests: Number(summary?.totalTests ?? 0), okTests: Number(summary?.okTests ?? 0) };
  });
}

export async function getChannelHealthAsync(period?: { since: number; until: number }) {
  if (!usePostgres()) return getChannelHealth(period);
  const { pgDb, pgSchema } = await import("./db/pg");
  const channels = await pgDb.select().from(pgSchema.channels).where(and(eq(pgSchema.channels.enabled, true), gte(pgSchema.channels.monitorIntervalSec, 1))).orderBy(pgSchema.channels.name);
  if (!period) return channels.map(c => ({ ...c, testLogs: [], totalTests: 0, okTests: 0 }));
  const summaries = await pgDb
    .select({
      channelId: pgSchema.channelTestLogs.channelId,
      totalTests: sql<number>`count(*)::int`,
      okTests: sql<number>`sum(case when ${pgSchema.channelTestLogs.ok} then 1 else 0 end)::int`,
    })
    .from(pgSchema.channelTestLogs)
    .where(and(gte(pgSchema.channelTestLogs.ts, period.since), lt(pgSchema.channelTestLogs.ts, period.until)))
    .groupBy(pgSchema.channelTestLogs.channelId);
  const summaryByChannel = new Map(summaries.map(row => [row.channelId, row]));
  const recentLogs = new Map<string, (typeof pgSchema.channelTestLogs.$inferSelect)[]>();
  for (const channel of channels) {
    recentLogs.set(channel.id, (await pgDb.select().from(pgSchema.channelTestLogs)
      .where(and(eq(pgSchema.channelTestLogs.channelId, channel.id), gte(pgSchema.channelTestLogs.ts, period.since), lt(pgSchema.channelTestLogs.ts, period.until)))
      .orderBy(desc(pgSchema.channelTestLogs.ts))
      .limit(CHANNEL_HEALTH_CELL_LIMIT))
      .reverse());
  }
  return channels.map(c => {
    const summary = summaryByChannel.get(c.id);
    return { ...c, testLogs: recentLogs.get(c.id) ?? [], totalTests: Number(summary?.totalTests ?? 0), okTests: Number(summary?.okTests ?? 0) };
  });
}

export function getRecentLogs(limit = 200, statusFilter: string = "all", opts: { userId?: string } = {}): LogListEntry[] {
  const where = statusFilter === "2xx"
    ? and(gte(schema.requestLogs.status, 200), lt(schema.requestLogs.status, 300))
    : statusFilter === "4xx"
    ? and(gte(schema.requestLogs.status, 400), lt(schema.requestLogs.status, 500))
    : statusFilter === "5xx"
    ? and(gte(schema.requestLogs.status, 500), lt(schema.requestLogs.status, 600))
    : statusFilter === "err"
    ? or(eq(schema.requestLogs.status, 0), gte(schema.requestLogs.status, 500))
    : undefined;
  const ownerWhere = opts.userId ? eq(schema.keys.userId, opts.userId) : undefined;
  const combinedWhere = where && ownerWhere ? and(where, ownerWhere) : where ?? ownerWhere;

  let query = db
    .select({
      id: schema.requestLogs.id,
      requestId: schema.requestLogs.requestId,
      ts: schema.requestLogs.ts,
      keyId: schema.requestLogs.keyId,
      channelId: schema.requestLogs.channelId,
      model: schema.requestLogs.model,
      inboundModel: schema.requestLogs.inboundModel,
      upstreamModel: schema.requestLogs.upstreamModel,
      mappingId: schema.requestLogs.mappingId,
      mappedChannelIds: schema.requestLogs.mappedChannelIds,
      status: schema.requestLogs.status,
      latencyMs: schema.requestLogs.latencyMs,
      ttftMs: schema.requestLogs.ttftMs,
      durationMs: schema.requestLogs.durationMs,
      tokensIn: schema.requestLogs.tokensIn,
      tokensOut: schema.requestLogs.tokensOut,
      cacheTokens: schema.requestLogs.cacheTokens,
      cacheReadTokens: schema.requestLogs.cacheReadTokens,
      cacheCreationTokens: schema.requestLogs.cacheCreationTokens,
      requestDetail: schema.requestLogs.requestDetail,
      hasDetail: sql<boolean>`(${schema.requestLogs.requestDetail} is not null or ${schema.requestLogs.errorMsg} is not null)`,
      keyName: schema.keys.name,
      keyPrefix: schema.keys.prefix,
      channelName: schema.channels.name,
      channelType: schema.channels.type,
      userName: schema.users.displayName,
      username: schema.users.username,
    })
    .from(schema.requestLogs)
    .leftJoin(schema.keys, eq(schema.keys.id, schema.requestLogs.keyId))
    .leftJoin(schema.users, eq(schema.users.id, schema.keys.userId))
    .leftJoin(schema.channels, eq(schema.channels.id, schema.requestLogs.channelId))
    .$dynamic();

  if (combinedWhere) query = query.where(combinedWhere);

  const rows = query
    .orderBy(desc(schema.requestLogs.ts))
    .limit(limit)
    .all();

  const prices = db.select().from(schema.modelPrices).all();
  const priceMap = new Map(prices.map(p => [p.channelId ? `${p.channelId}:${p.model}` : `${p.provider}:${p.model}`, p]));
  const settings = getSettings();

  return rows.map(row => {
    const { requestDetail, ...rest } = row;
    return {
      ...rest,
      keyName: row.keyName ?? "未认证",
      keyPrefix: row.keyPrefix ?? "—",
      channelName: row.channelName ?? "未选择",
      channelType: row.channelType ?? "openai",
      userName: row.userName ?? row.username ?? "未知用户",
      username: row.username ?? "",
      reasoningEffort: reasoningEffortFromDetail(requestDetail),
      cost: applyBillingMultipliers(logCost(row.channelType ?? "openai", row.channelId, row.model, row.tokensIn, row.tokensOut, row.cacheReadTokens, row.cacheCreationTokens, priceMap), row.channelType ?? "openai", settings),
    };
  }) as LogListEntry[];
}

export async function getRecentLogsAsync(limit = 200, statusFilter: string = "all", opts: { userId?: string } = {}): Promise<LogListEntry[]> {
  if (!usePostgres()) return getRecentLogs(limit, statusFilter, opts);
  const { pgDb, pgSchema } = await import("./db/pg");
  const where = statusFilter === "2xx"
    ? and(gte(pgSchema.requestLogs.status, 200), lt(pgSchema.requestLogs.status, 300))
    : statusFilter === "4xx"
    ? and(gte(pgSchema.requestLogs.status, 400), lt(pgSchema.requestLogs.status, 500))
    : statusFilter === "5xx"
    ? and(gte(pgSchema.requestLogs.status, 500), lt(pgSchema.requestLogs.status, 600))
    : statusFilter === "err"
    ? or(eq(pgSchema.requestLogs.status, 0), gte(pgSchema.requestLogs.status, 500))
    : undefined;
  const ownerWhere = opts.userId ? eq(pgSchema.keys.userId, opts.userId) : undefined;
  const combinedWhere = where && ownerWhere ? and(where, ownerWhere) : where ?? ownerWhere;
  let query = pgDb
    .select({
      id: pgSchema.requestLogs.id,
      requestId: pgSchema.requestLogs.requestId,
      ts: pgSchema.requestLogs.ts,
      keyId: pgSchema.requestLogs.keyId,
      channelId: pgSchema.requestLogs.channelId,
      model: pgSchema.requestLogs.model,
      inboundModel: pgSchema.requestLogs.inboundModel,
      upstreamModel: pgSchema.requestLogs.upstreamModel,
      mappingId: pgSchema.requestLogs.mappingId,
      mappedChannelIds: pgSchema.requestLogs.mappedChannelIds,
      status: pgSchema.requestLogs.status,
      latencyMs: pgSchema.requestLogs.latencyMs,
      ttftMs: pgSchema.requestLogs.ttftMs,
      durationMs: pgSchema.requestLogs.durationMs,
      tokensIn: pgSchema.requestLogs.tokensIn,
      tokensOut: pgSchema.requestLogs.tokensOut,
      cacheTokens: pgSchema.requestLogs.cacheTokens,
      cacheReadTokens: pgSchema.requestLogs.cacheReadTokens,
      cacheCreationTokens: pgSchema.requestLogs.cacheCreationTokens,
      requestDetail: pgSchema.requestLogs.requestDetail,
      hasDetail: sql<boolean>`(${pgSchema.requestLogs.requestDetail} is not null or ${pgSchema.requestLogs.errorMsg} is not null)`,
      keyName: pgSchema.keys.name,
      keyPrefix: pgSchema.keys.prefix,
      channelName: pgSchema.channels.name,
      channelType: pgSchema.channels.type,
      userName: pgSchema.users.displayName,
      username: pgSchema.users.username,
    })
    .from(pgSchema.requestLogs)
    .leftJoin(pgSchema.keys, eq(pgSchema.keys.id, pgSchema.requestLogs.keyId))
    .leftJoin(pgSchema.users, eq(pgSchema.users.id, pgSchema.keys.userId))
    .leftJoin(pgSchema.channels, eq(pgSchema.channels.id, pgSchema.requestLogs.channelId))
    .$dynamic();
  if (combinedWhere) query = query.where(combinedWhere);
  const rows = await query.orderBy(desc(pgSchema.requestLogs.ts)).limit(limit);
  const prices = await pgDb.select().from(pgSchema.modelPrices);
  const priceMap = new Map(prices.map(p => [p.channelId ? `${p.channelId}:${p.model}` : `${p.provider}:${p.model}`, p]));
  const settings = await getSettingsAsync();
  return rows.map(row => {
    const { requestDetail, ...rest } = row;
    return {
      ...rest,
      keyName: row.keyName ?? "未认证",
      keyPrefix: row.keyPrefix ?? "—",
      channelName: row.channelName ?? "未选择",
      channelType: row.channelType ?? "openai",
      userName: row.userName ?? row.username ?? "未知用户",
      username: row.username ?? "",
      reasoningEffort: reasoningEffortFromDetail(requestDetail),
      cost: applyBillingMultipliers(logCost(row.channelType ?? "openai", row.channelId, row.model, row.tokensIn, row.tokensOut, row.cacheReadTokens, row.cacheCreationTokens, priceMap), row.channelType ?? "openai", settings),
    };
  }) as LogListEntry[];
}

export type LogDetail = Pick<LogEntry, "id" | "requestId" | "status" | "model" | "inboundModel" | "upstreamModel" | "requestDetail" | "errorMsg">;

export function getLogDetail(id: number, opts: { userId?: string } = {}): LogDetail | null {
  let query = db
    .select({
      id: schema.requestLogs.id,
      requestId: schema.requestLogs.requestId,
      status: schema.requestLogs.status,
      model: schema.requestLogs.model,
      inboundModel: schema.requestLogs.inboundModel,
      upstreamModel: schema.requestLogs.upstreamModel,
      requestDetail: schema.requestLogs.requestDetail,
      errorMsg: schema.requestLogs.errorMsg,
    })
    .from(schema.requestLogs)
    .leftJoin(schema.keys, eq(schema.keys.id, schema.requestLogs.keyId))
    .$dynamic();
  query = query.where(opts.userId ? and(eq(schema.requestLogs.id, id), eq(schema.keys.userId, opts.userId)) : eq(schema.requestLogs.id, id));
  return (query.limit(1).get() ?? null) as LogDetail | null;
}

export async function getLogDetailAsync(id: number, opts: { userId?: string } = {}): Promise<LogDetail | null> {
  if (!usePostgres()) return getLogDetail(id, opts);
  const { pgDb, pgSchema } = await import("./db/pg");
  let query = pgDb
    .select({
      id: pgSchema.requestLogs.id,
      requestId: pgSchema.requestLogs.requestId,
      status: pgSchema.requestLogs.status,
      model: pgSchema.requestLogs.model,
      inboundModel: pgSchema.requestLogs.inboundModel,
      upstreamModel: pgSchema.requestLogs.upstreamModel,
      requestDetail: pgSchema.requestLogs.requestDetail,
      errorMsg: pgSchema.requestLogs.errorMsg,
    })
    .from(pgSchema.requestLogs)
    .leftJoin(pgSchema.keys, eq(pgSchema.keys.id, pgSchema.requestLogs.keyId))
    .$dynamic();
  query = query.where(opts.userId ? and(eq(pgSchema.requestLogs.id, id), eq(pgSchema.keys.userId, opts.userId)) : eq(pgSchema.requestLogs.id, id));
  return ((await query.limit(1))[0] ?? null) as LogDetail | null;
}

function logCost(
  provider: "claude" | "openai",
  channelId: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  priceMap: Map<string, Pick<typeof schema.modelPrices.$inferSelect, "inputPricePerMTok" | "outputPricePerMTok" | "cacheReadPricePerMTok" | "cacheCreationPricePerMTok">>,
) {
  const models = modelLookupCandidates(model);
  let price: Pick<typeof schema.modelPrices.$inferSelect, "inputPricePerMTok" | "outputPricePerMTok" | "cacheReadPricePerMTok" | "cacheCreationPricePerMTok"> | undefined;
  for (const candidate of models) {
    price = priceMap.get(`${channelId}:${candidate}`);
    if (price) break;
  }
  if (!price) {
    for (const candidate of models) {
      price = priceMap.get(`${provider}:${candidate}`);
      if (price) break;
    }
  }
  if (!price) return 0;
  return (tokensIn / 1_000_000) * price.inputPricePerMTok
    + (tokensOut / 1_000_000) * price.outputPricePerMTok
    + (cacheReadTokens / 1_000_000) * price.cacheReadPricePerMTok
    + (cacheCreationTokens / 1_000_000) * price.cacheCreationPricePerMTok;
}

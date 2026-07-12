import { db, schema } from "./db";
import { eq, sql } from "drizzle-orm";
import type { LogEntry, LogListEntry } from "./types";
import { getRedis } from "@/lib/redis";
import { usePostgres } from "@/lib/db/runtime";
import { modelLookupCandidates } from "@/lib/model-variants";
import { getSettings, getSettingsAsync } from "@/lib/settings";
import { upsertRequestStatAsync } from "@/lib/request-stats";

type Subscriber = (entry: LogListEntry) => void;
type LogInput = Omit<LogEntry, "id" | "cacheTokens" | "cacheReadTokens" | "cacheCreationTokens" | "ttftMs" | "durationMs" | "cost"> & {
  cacheTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  ttftMs?: number;
  durationMs?: number;
  cost?: number;
};

class LogHub {
  version = 5;
  private subscribers = new Set<Subscriber>();
  private redisStarted = false;
  private instanceId = crypto.randomUUID();

  subscribe(fn: Subscriber) {
    this.startRedisFanout();
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }

  /**
   * 记录一条请求日志：写库 + 推送给所有 SSE 订阅者。
   * 仅由真实代理路径调用。
   */
  record(e: LogInput): LogEntry {
    const ts = e.ts || Date.now();
    const info = db.insert(schema.requestLogs).values({
      ts,
      requestId: e.requestId,
      keyId: e.keyId, channelId: e.channelId, model: e.model,
      inboundModel: e.inboundModel || e.model,
      upstreamModel: e.upstreamModel || e.model,
      mappingId: e.mappingId || "",
      mappedChannelIds: e.mappedChannelIds ?? [],
      status: e.status, latencyMs: e.latencyMs,
      ttftMs: e.ttftMs ?? e.latencyMs,
      durationMs: e.durationMs ?? e.latencyMs,
      tokensIn: e.tokensIn, tokensOut: e.tokensOut,
      cacheTokens: e.cacheTokens ?? 0,
      cacheReadTokens: e.cacheReadTokens ?? 0,
      cacheCreationTokens: e.cacheCreationTokens ?? 0,
      requestDetail: e.requestDetail ?? null,
      errorMsg: e.errorMsg,
    }).run();

    if (e.keyId) {
      const cost = e.cost ?? logCost(e.channelType, e.channelId, e.model, e.tokensIn, e.tokensOut, e.cacheReadTokens ?? 0, e.cacheCreationTokens ?? 0);
      const addTok = (e.tokensIn + e.tokensOut) / 1_000_000;
      const key = db.select().from(schema.keys).where(eq(schema.keys.id, e.keyId)).get();
      db.update(schema.keys)
        .set({
          lastUsedAt: ts,
          used: (key?.used ?? 0) + addTok,
        })
        .where(eq(schema.keys.id, e.keyId))
        .run();
      addUserUsage(key?.userId, e.tokensIn + e.tokensOut, cost);
    }

    const entry: LogEntry = {
      id: Number(info.lastInsertRowid),
      requestId: e.requestId,
      ts,
      keyId: e.keyId, keyName: e.keyName, keyPrefix: e.keyPrefix,
      channelId: e.channelId, channelName: e.channelName, channelType: e.channelType,
      model: e.model, status: e.status, latencyMs: e.latencyMs,
      inboundModel: e.inboundModel || e.model,
      upstreamModel: e.upstreamModel || e.model,
      mappingId: e.mappingId || "",
      mappedChannelIds: e.mappedChannelIds ?? [],
      ttftMs: e.ttftMs ?? e.latencyMs,
      durationMs: e.durationMs ?? e.latencyMs,
      tokensIn: e.tokensIn, tokensOut: e.tokensOut,
      cacheTokens: e.cacheTokens ?? 0,
      cacheReadTokens: e.cacheReadTokens ?? 0,
      cacheCreationTokens: e.cacheCreationTokens ?? 0,
      requestDetail: e.requestDetail ?? null,
      errorMsg: e.errorMsg,
      cost: e.cost ?? 0,
    };
    for (const sub of this.subscribers) {
      try { sub(toLogListEntry(entry)); } catch { /* */ }
    }
    this.publish(toLogListEntry(entry));
    return entry;
  }

  async recordAsync(e: LogInput): Promise<LogEntry> {
    if (!usePostgres()) return this.record(e);
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    const ts = e.ts || Date.now();
    const inserted = await pgDb.insert(pgSchema.requestLogs).values({
      ts,
      requestId: e.requestId,
      keyId: e.keyId, channelId: e.channelId, model: e.model,
      inboundModel: e.inboundModel || e.model,
      upstreamModel: e.upstreamModel || e.model,
      mappingId: e.mappingId || "",
      mappedChannelIds: e.mappedChannelIds ?? [],
      status: e.status, latencyMs: e.latencyMs,
      ttftMs: e.ttftMs ?? e.latencyMs,
      durationMs: e.durationMs ?? e.latencyMs,
      tokensIn: e.tokensIn, tokensOut: e.tokensOut,
      cacheTokens: e.cacheTokens ?? 0,
      cacheReadTokens: e.cacheReadTokens ?? 0,
      cacheCreationTokens: e.cacheCreationTokens ?? 0,
      requestDetail: e.requestDetail ?? null,
      errorMsg: e.errorMsg,
    }).returning({ id: pgSchema.requestLogs.id });

    const key = e.keyId ? (await pgDb.select().from(pgSchema.keys).where(eq(pgSchema.keys.id, e.keyId)).limit(1))[0] : undefined;
    if (e.keyId) {
      const cost = e.cost ?? await logCostAsync(e.channelType, e.channelId, e.model, e.tokensIn, e.tokensOut, e.cacheReadTokens ?? 0, e.cacheCreationTokens ?? 0);
      const addTok = (e.tokensIn + e.tokensOut) / 1_000_000;
      await pgDb.update(pgSchema.keys).set({ lastUsedAt: ts, used: sql`${pgSchema.keys.used} + ${addTok}` }).where(eq(pgSchema.keys.id, e.keyId));
      await addUserUsageAsync(key?.userId, e.tokensIn + e.tokensOut, cost);
    }

    const rawLogId = Number(inserted[0]?.id ?? 0);
    if (rawLogId) await upsertRequestStatAsync(rawLogId, requestStatFromInput(ts, e, key?.userId ?? ""));
    const entry = logEntryFromInput(rawLogId, ts, e);
    const listEntry = toLogListEntry(entry);
    this.emit(listEntry);
    this.publish(listEntry);
    return entry;
  }

  update(id: number, e: LogInput): LogEntry {
    const prev = db.select().from(schema.requestLogs).where(eq(schema.requestLogs.id, id)).get();
    db.update(schema.requestLogs).set({
      ts: e.ts,
      requestId: e.requestId,
      keyId: e.keyId,
      channelId: e.channelId,
      model: e.model,
      inboundModel: e.inboundModel || e.model,
      upstreamModel: e.upstreamModel || e.model,
      mappingId: e.mappingId || "",
      mappedChannelIds: e.mappedChannelIds ?? [],
      status: e.status,
      latencyMs: e.latencyMs,
      ttftMs: e.ttftMs ?? e.latencyMs,
      durationMs: e.durationMs ?? e.latencyMs,
      tokensIn: e.tokensIn,
      tokensOut: e.tokensOut,
      cacheTokens: e.cacheTokens ?? 0,
      cacheReadTokens: e.cacheReadTokens ?? 0,
      cacheCreationTokens: e.cacheCreationTokens ?? 0,
      requestDetail: e.requestDetail ?? null,
      errorMsg: e.errorMsg,
    }).where(eq(schema.requestLogs.id, id)).run();

    if (e.keyId) {
      const oldTokens = prev ? prev.tokensIn + prev.tokensOut : 0;
      const newTokens = e.tokensIn + e.tokensOut;
      const oldCost = prev ? logCost(e.channelType, e.channelId, prev.model, prev.tokensIn, prev.tokensOut, prev.cacheReadTokens, prev.cacheCreationTokens) : 0;
      const newCost = e.cost ?? logCost(e.channelType, e.channelId, e.model, e.tokensIn, e.tokensOut, e.cacheReadTokens ?? 0, e.cacheCreationTokens ?? 0);
      const addTok = (newTokens - oldTokens) / 1_000_000;
      if (addTok !== 0) {
        const key = db.select().from(schema.keys).where(eq(schema.keys.id, e.keyId)).get();
        db.update(schema.keys)
          .set({ lastUsedAt: e.ts, used: (key?.used ?? 0) + addTok })
          .where(eq(schema.keys.id, e.keyId))
          .run();
          addUserUsage(key?.userId, newTokens - oldTokens, newCost - oldCost);
      }
    }

    const entry: LogEntry = {
      id,
      requestId: e.requestId,
      ts: e.ts,
      keyId: e.keyId, keyName: e.keyName, keyPrefix: e.keyPrefix,
      channelId: e.channelId, channelName: e.channelName, channelType: e.channelType,
      model: e.model, status: e.status, latencyMs: e.latencyMs,
      inboundModel: e.inboundModel || e.model,
      upstreamModel: e.upstreamModel || e.model,
      mappingId: e.mappingId || "",
      mappedChannelIds: e.mappedChannelIds ?? [],
      ttftMs: e.ttftMs ?? e.latencyMs,
      durationMs: e.durationMs ?? e.latencyMs,
      tokensIn: e.tokensIn, tokensOut: e.tokensOut,
      cacheTokens: e.cacheTokens ?? 0,
      cacheReadTokens: e.cacheReadTokens ?? 0,
      cacheCreationTokens: e.cacheCreationTokens ?? 0,
      requestDetail: e.requestDetail ?? null,
      errorMsg: e.errorMsg,
      cost: e.cost ?? 0,
    };
    for (const sub of this.subscribers) {
      try { sub(toLogListEntry(entry)); } catch { /* */ }
    }
    this.publish(toLogListEntry(entry));
    return entry;
  }

  async updateAsync(id: number, e: LogInput): Promise<LogEntry> {
    if (!usePostgres()) return this.update(id, e);
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    const prev = (await pgDb.select().from(pgSchema.requestLogs).where(eq(pgSchema.requestLogs.id, id)).limit(1))[0];
    await pgDb.update(pgSchema.requestLogs).set({
      ts: e.ts,
      requestId: e.requestId,
      keyId: e.keyId,
      channelId: e.channelId,
      model: e.model,
      inboundModel: e.inboundModel || e.model,
      upstreamModel: e.upstreamModel || e.model,
      mappingId: e.mappingId || "",
      mappedChannelIds: e.mappedChannelIds ?? [],
      status: e.status,
      latencyMs: e.latencyMs,
      ttftMs: e.ttftMs ?? e.latencyMs,
      durationMs: e.durationMs ?? e.latencyMs,
      tokensIn: e.tokensIn,
      tokensOut: e.tokensOut,
      cacheTokens: e.cacheTokens ?? 0,
      cacheReadTokens: e.cacheReadTokens ?? 0,
      cacheCreationTokens: e.cacheCreationTokens ?? 0,
      requestDetail: e.requestDetail ?? null,
      errorMsg: e.errorMsg,
    }).where(eq(pgSchema.requestLogs.id, id));

    const key = e.keyId ? (await pgDb.select().from(pgSchema.keys).where(eq(pgSchema.keys.id, e.keyId)).limit(1))[0] : undefined;
    if (e.keyId) {
      const oldTokens = prev ? prev.tokensIn + prev.tokensOut : 0;
      const newTokens = e.tokensIn + e.tokensOut;
      const oldCost = prev ? await logCostAsync(e.channelType, e.channelId, prev.model, prev.tokensIn, prev.tokensOut, prev.cacheReadTokens, prev.cacheCreationTokens) : 0;
      const newCost = e.cost ?? await logCostAsync(e.channelType, e.channelId, e.model, e.tokensIn, e.tokensOut, e.cacheReadTokens ?? 0, e.cacheCreationTokens ?? 0);
      const addTok = (newTokens - oldTokens) / 1_000_000;
      if (addTok !== 0) {
        await pgDb.update(pgSchema.keys).set({ lastUsedAt: e.ts, used: sql`${pgSchema.keys.used} + ${addTok}` }).where(eq(pgSchema.keys.id, e.keyId));
        await addUserUsageAsync(key?.userId, newTokens - oldTokens, newCost - oldCost);
      }
    }

    await upsertRequestStatAsync(id, requestStatFromInput(e.ts, e, key?.userId ?? ""));
    const entry = logEntryFromInput(id, e.ts, e);
    const listEntry = toLogListEntry(entry);
    this.emit(listEntry);
    this.publish(listEntry);
    return entry;
  }

  private emit(entry: LogListEntry) {
    for (const sub of this.subscribers) {
      try { sub(entry); } catch { /* */ }
    }
  }

  private publish(entry: LogListEntry) {
    void getRedis().then(redis => redis?.publish("logs:stream", JSON.stringify({ instanceId: this.instanceId, entry }))).catch(() => null);
  }

  private startRedisFanout() {
    if (this.redisStarted) return;
    this.redisStarted = true;
    void getRedis().then(async redis => {
      if (!redis) return;
      const subscriber = redis.duplicate();
      await subscriber.connect();
      await subscriber.subscribe("logs:stream", message => {
        try {
          const data = JSON.parse(message) as { instanceId?: string; entry?: LogEntry | LogListEntry };
          if (data.instanceId === this.instanceId || !data.entry) return;
          const entry = toLogListEntry(data.entry);
          for (const sub of this.subscribers) {
            try { sub(entry); } catch { /* */ }
          }
        } catch { /* ignore malformed pubsub messages */ }
      });
    }).catch(() => { this.redisStarted = false; });
  }
}

function toLogListEntry(entry: LogEntry | LogListEntry): LogListEntry {
  const full = entry as LogEntry & { hasDetail?: boolean };
  const { requestDetail, errorMsg, ...rest } = full;
  return { ...rest, hasDetail: full.hasDetail || Boolean(requestDetail || errorMsg) };
}

function requestStatFromInput(ts: number, e: LogInput, userId: string) {
  return {
    requestId: e.requestId,
    ts,
    keyId: e.keyId,
    userId,
    channelId: e.channelId,
    channelType: e.channelType,
    model: e.model,
    status: e.status,
    latencyMs: e.latencyMs,
    ttftMs: e.ttftMs ?? e.latencyMs,
    durationMs: e.durationMs ?? e.latencyMs,
    tokensIn: e.tokensIn,
    tokensOut: e.tokensOut,
    cacheTokens: e.cacheTokens ?? 0,
    cacheReadTokens: e.cacheReadTokens ?? 0,
    cacheCreationTokens: e.cacheCreationTokens ?? 0,
  };
}

function addUserUsage(userId: string | undefined, tokens: number, usd: number) {
  if (!userId || (tokens === 0 && usd === 0)) return;
  const quota = db.select().from(schema.userQuotas).where(eq(schema.userQuotas.userId, userId)).get();
  if (!quota) return;
  db.update(schema.userQuotas)
    .set({
      dailyUsedTokens: Math.max(0, quota.dailyUsedTokens + tokens),
      monthlyUsedTokens: Math.max(0, quota.monthlyUsedTokens + tokens),
      dailyUsedUsd: Math.max(0, quota.dailyUsedUsd + usd),
      monthlyUsedUsd: Math.max(0, quota.monthlyUsedUsd + usd),
      usedUsd: Math.max(0, quota.usedUsd + usd),
      updatedAt: Date.now(),
    })
    .where(eq(schema.userQuotas.userId, userId))
    .run();
}

async function addUserUsageAsync(userId: string | undefined, tokens: number, usd: number) {
  if (!userId || (tokens === 0 && usd === 0)) return;
  const { pgDb, pgSchema } = await import("@/lib/db/pg");
  const quota = (await pgDb.select().from(pgSchema.userQuotas).where(eq(pgSchema.userQuotas.userId, userId)).limit(1))[0];
  if (!quota) return;
  await pgDb.update(pgSchema.userQuotas)
    .set({
      dailyUsedTokens: sql`GREATEST(0, ${pgSchema.userQuotas.dailyUsedTokens} + ${tokens})`,
      monthlyUsedTokens: sql`GREATEST(0, ${pgSchema.userQuotas.monthlyUsedTokens} + ${tokens})`,
      dailyUsedUsd: sql`GREATEST(0, ${pgSchema.userQuotas.dailyUsedUsd} + ${usd})`,
      monthlyUsedUsd: sql`GREATEST(0, ${pgSchema.userQuotas.monthlyUsedUsd} + ${usd})`,
      usedUsd: sql`GREATEST(0, ${pgSchema.userQuotas.usedUsd} + ${usd})`,
      updatedAt: Date.now(),
    })
    .where(eq(pgSchema.userQuotas.userId, userId));
}

function logCost(provider: "claude" | "openai", channelId: string, model: string, tokensIn: number, tokensOut: number, cacheReadTokens: number, cacheCreationTokens: number) {
  const candidates = modelLookupCandidates(model);
  const prices = db.select().from(schema.modelPrices).all().filter(row => candidates.includes(row.model));
  const resolvedPrice = resolvePrice(provider, channelId, candidates, prices);
  if (!resolvedPrice) return 0;
  return ((tokensIn / 1_000_000) * resolvedPrice.inputPricePerMTok
    + (tokensOut / 1_000_000) * resolvedPrice.outputPricePerMTok
    + (cacheReadTokens / 1_000_000) * resolvedPrice.cacheReadPricePerMTok
    + (cacheCreationTokens / 1_000_000) * resolvedPrice.cacheCreationPricePerMTok) * getSettings().globalBillingMultiplier;
}

async function logCostAsync(provider: "claude" | "openai", channelId: string, model: string, tokensIn: number, tokensOut: number, cacheReadTokens: number, cacheCreationTokens: number) {
  const { pgDb, pgSchema } = await import("@/lib/db/pg");
  const candidates = modelLookupCandidates(model);
  const prices = (await pgDb.select().from(pgSchema.modelPrices)).filter(row => candidates.includes(row.model));
  const price = resolvePrice(provider, channelId, candidates, prices);
  if (!price) return 0;
  const billingMultiplier = (await getSettingsAsync()).globalBillingMultiplier;
  return ((tokensIn / 1_000_000) * price.inputPricePerMTok
    + (tokensOut / 1_000_000) * price.outputPricePerMTok
    + (cacheReadTokens / 1_000_000) * price.cacheReadPricePerMTok
    + (cacheCreationTokens / 1_000_000) * price.cacheCreationPricePerMTok) * billingMultiplier;
}

function resolvePrice<T extends { provider: string; channelId?: string; model: string }>(provider: "claude" | "openai", channelId: string, models: string[], prices: T[]) {
  for (const model of models) {
    const channelPrice = prices.find(p => p.channelId === channelId && p.model === model);
    if (channelPrice) return channelPrice;
  }
  for (const model of models) {
    const providerPrice = prices.find(p => !p.channelId && p.provider === provider && p.model === model);
    if (providerPrice) return providerPrice;
  }
  return null;
}

function logEntryFromInput(id: number, ts: number, e: LogInput): LogEntry {
  return {
    id,
    requestId: e.requestId,
    ts,
    keyId: e.keyId, keyName: e.keyName, keyPrefix: e.keyPrefix,
    channelId: e.channelId, channelName: e.channelName, channelType: e.channelType,
    model: e.model, status: e.status, latencyMs: e.latencyMs,
    inboundModel: e.inboundModel || e.model,
    upstreamModel: e.upstreamModel || e.model,
    mappingId: e.mappingId || "",
    mappedChannelIds: e.mappedChannelIds ?? [],
    ttftMs: e.ttftMs ?? e.latencyMs,
    durationMs: e.durationMs ?? e.latencyMs,
    tokensIn: e.tokensIn, tokensOut: e.tokensOut,
    cacheTokens: e.cacheTokens ?? 0,
    cacheReadTokens: e.cacheReadTokens ?? 0,
    cacheCreationTokens: e.cacheCreationTokens ?? 0,
    requestDetail: e.requestDetail ?? null,
    errorMsg: e.errorMsg,
    cost: e.cost ?? 0,
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __logHub: LogHub | undefined;
}

const existing = globalThis.__logHub as (LogHub & { update?: unknown; version?: number }) | undefined;
export const logHub = existing && existing.version === 5 && typeof existing.update === "function" ? existing : new LogHub();
globalThis.__logHub = logHub;

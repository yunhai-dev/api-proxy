import { db, schema } from "./db";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { usePostgres } from "./db/runtime";
import { getSettings, getSettingsAsync } from "./settings";

export function getUserDetail(userId: string, period?: { since: number; until: number }) {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return null;
  const quota = db.select().from(schema.userQuotas).where(eq(schema.userQuotas.userId, userId)).get();
  const keys = db.select().from(schema.keys).where(eq(schema.keys.userId, userId)).all();
  const keyIds = new Set(keys.map(k => k.id));
  const logs = db.select().from(schema.requestLogs).orderBy(desc(schema.requestLogs.ts)).all().filter(log => {
    if (!keyIds.has(log.keyId)) return false;
    if (period && (log.ts < period.since || log.ts >= period.until)) return false;
    return true;
  });
  const prices = db.select().from(schema.modelPrices).all();
  const priceMap = new Map(prices.map(p => [p.channelId ? `${p.channelId}:${p.model}` : `${p.provider}:${p.model}`, p]));
  const billingMultiplier = getSettings().globalBillingMultiplier;

  const requests = logs.length;
  const successes = logs.filter(log => log.status >= 200 && log.status < 300).length;
  const tokensIn = logs.reduce((sum, log) => sum + log.tokensIn, 0);
  const tokensOut = logs.reduce((sum, log) => sum + log.tokensOut, 0);
  const cacheReadTokens = logs.reduce((sum, log) => sum + log.cacheReadTokens, 0);
  const cacheCreationTokens = logs.reduce((sum, log) => sum + log.cacheCreationTokens, 0);
  const cost = logs.reduce((sum, log) => sum + costFor(log.model, tokensProvider(log.channelId), log.channelId, log.tokensIn, log.tokensOut, log.cacheReadTokens, log.cacheCreationTokens, priceMap, billingMultiplier), 0);
  const byModel = new Map<string, { model: string; requests: number; tokens: number; cost: number }>();
  const byKey = new Map<string, { keyId: string; requests: number; tokens: number; cost: number }>();
  const now = period?.until ?? Date.now();
  const since = period?.since ?? now - 24 * 60 * 60 * 1000;
  const bucketCount = 24;
  const bucketMs = (now - since) / bucketCount;
  const tokenSeries = Array.from({ length: bucketCount }, (_, i) => ({
    ts: Math.round(since + i * bucketMs),
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
  }));
  for (const log of logs) {
    const provider = tokensProvider(log.channelId);
    const cur = byModel.get(log.model) ?? { model: log.model, requests: 0, tokens: 0, cost: 0 };
    cur.requests += 1;
    cur.tokens += log.tokensIn + log.tokensOut + log.cacheReadTokens + log.cacheCreationTokens;
    cur.cost += costFor(log.model, provider, log.channelId, log.tokensIn, log.tokensOut, log.cacheReadTokens, log.cacheCreationTokens, priceMap, billingMultiplier);
    byModel.set(log.model, cur);
    const keyCur = byKey.get(log.keyId) ?? { keyId: log.keyId, requests: 0, tokens: 0, cost: 0 };
    keyCur.requests += 1;
    keyCur.tokens += log.tokensIn + log.tokensOut + log.cacheReadTokens + log.cacheCreationTokens;
    keyCur.cost += costFor(log.model, provider, log.channelId, log.tokensIn, log.tokensOut, log.cacheReadTokens, log.cacheCreationTokens, priceMap, billingMultiplier);
    byKey.set(log.keyId, keyCur);
    if (log.ts >= since && log.ts <= now) {
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((log.ts - since) / bucketMs)));
      tokenSeries[idx].input += log.tokensIn;
      tokenSeries[idx].output += log.tokensOut;
      tokenSeries[idx].cacheRead += log.cacheReadTokens;
      tokenSeries[idx].cacheCreation += log.cacheCreationTokens;
    }
  }

  return {
    user,
    quota,
    keys: keys.map(key => ({ ...key, periodStats: byKey.get(key.id) ?? { keyId: key.id, requests: 0, tokens: 0, cost: 0 } })),
    stats: {
      requests,
      successRate: requests ? (successes / requests) * 100 : 100,
      tokensIn,
      tokensOut,
      cacheReadTokens,
      cacheCreationTokens,
      cost,
      models: [...byModel.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10),
      tokenSeries,
      recentLogs: logs.slice(0, 20),
    },
  };
}

export async function getUserDetailAsync(userId: string, period?: { since: number; until: number }) {
  if (!usePostgres()) return getUserDetail(userId, period);
  const { pgDb, pgSchema } = await import("./db/pg");
  const user = (await pgDb.select().from(pgSchema.users).where(eq(pgSchema.users.id, userId)).limit(1))[0];
  if (!user) return null;
  const quota = (await pgDb.select().from(pgSchema.userQuotas).where(eq(pgSchema.userQuotas.userId, userId)).limit(1))[0] ?? null;
  const keys = await pgDb.select().from(pgSchema.keys).where(eq(pgSchema.keys.userId, userId));
  const logWhere = period
    ? and(eq(pgSchema.requestStats.userId, userId), gte(pgSchema.requestStats.ts, period.since), lt(pgSchema.requestStats.ts, period.until))
    : eq(pgSchema.requestStats.userId, userId);
  const logs = await pgDb
    .select({
      id: pgSchema.requestStats.rawLogId,
      ts: pgSchema.requestStats.ts,
      keyId: pgSchema.requestStats.keyId,
      channelId: pgSchema.requestStats.channelId,
      model: pgSchema.requestStats.model,
      status: pgSchema.requestStats.status,
      tokensIn: pgSchema.requestStats.tokensIn,
      tokensOut: pgSchema.requestStats.tokensOut,
      cacheReadTokens: pgSchema.requestStats.cacheReadTokens,
      cacheCreationTokens: pgSchema.requestStats.cacheCreationTokens,
      channelType: pgSchema.requestStats.channelType,
    })
    .from(pgSchema.requestStats)
    .where(logWhere)
    .orderBy(desc(pgSchema.requestStats.ts));
  const keyIds = keys.map(key => key.id);
  const recentWhere = period
    ? and(inArray(pgSchema.requestLogs.keyId, keyIds), gte(pgSchema.requestLogs.ts, period.since), lt(pgSchema.requestLogs.ts, period.until))
    : inArray(pgSchema.requestLogs.keyId, keyIds);
  const recentLogs = keyIds.length > 0
    ? await pgDb.select().from(pgSchema.requestLogs).where(recentWhere).orderBy(desc(pgSchema.requestLogs.ts)).limit(20)
    : [];
  const prices = await pgDb.select().from(pgSchema.modelPrices);
  const priceMap = new Map(prices.map(p => [p.channelId ? `${p.channelId}:${p.model}` : `${p.provider}:${p.model}`, p]));
  const billingMultiplier = (await getSettingsAsync()).globalBillingMultiplier;

  const requests = logs.length;
  const successes = logs.filter(log => log.status >= 200 && log.status < 300).length;
  const tokensIn = logs.reduce((sum, log) => sum + log.tokensIn, 0);
  const tokensOut = logs.reduce((sum, log) => sum + log.tokensOut, 0);
  const cacheReadTokens = logs.reduce((sum, log) => sum + log.cacheReadTokens, 0);
  const cacheCreationTokens = logs.reduce((sum, log) => sum + log.cacheCreationTokens, 0);
  const cost = logs.reduce((sum, log) => sum + costFor(log.model, log.channelType, log.channelId, log.tokensIn, log.tokensOut, log.cacheReadTokens, log.cacheCreationTokens, priceMap, billingMultiplier), 0);
  const byModel = new Map<string, { model: string; requests: number; tokens: number; cost: number }>();
  const byKey = new Map<string, { keyId: string; requests: number; tokens: number; cost: number }>();
  const now = period?.until ?? Date.now();
  const since = period?.since ?? now - 24 * 60 * 60 * 1000;
  const bucketCount = 24;
  const bucketMs = Math.max(1, (now - since) / bucketCount);
  const tokenSeries = Array.from({ length: bucketCount }, (_, i) => ({ ts: Math.round(since + i * bucketMs), input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }));
  for (const log of logs) {
    const provider = log.channelType;
    const cur = byModel.get(log.model) ?? { model: log.model, requests: 0, tokens: 0, cost: 0 };
    cur.requests += 1;
    cur.tokens += log.tokensIn + log.tokensOut + log.cacheReadTokens + log.cacheCreationTokens;
    cur.cost += costFor(log.model, provider, log.channelId, log.tokensIn, log.tokensOut, log.cacheReadTokens, log.cacheCreationTokens, priceMap, billingMultiplier);
    byModel.set(log.model, cur);
    const keyCur = byKey.get(log.keyId) ?? { keyId: log.keyId, requests: 0, tokens: 0, cost: 0 };
    keyCur.requests += 1;
    keyCur.tokens += log.tokensIn + log.tokensOut + log.cacheReadTokens + log.cacheCreationTokens;
    keyCur.cost += costFor(log.model, provider, log.channelId, log.tokensIn, log.tokensOut, log.cacheReadTokens, log.cacheCreationTokens, priceMap, billingMultiplier);
    byKey.set(log.keyId, keyCur);
    if (log.ts >= since && log.ts <= now) {
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((log.ts - since) / bucketMs)));
      tokenSeries[idx].input += log.tokensIn;
      tokenSeries[idx].output += log.tokensOut;
      tokenSeries[idx].cacheRead += log.cacheReadTokens;
      tokenSeries[idx].cacheCreation += log.cacheCreationTokens;
    }
  }
  return {
    user,
    quota,
    keys: keys.map(key => ({ ...key, periodStats: byKey.get(key.id) ?? { keyId: key.id, requests: 0, tokens: 0, cost: 0 } })),
    stats: {
      requests,
      successRate: requests ? (successes / requests) * 100 : 100,
      tokensIn,
      tokensOut,
      cacheReadTokens,
      cacheCreationTokens,
      cost,
      models: [...byModel.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10),
      tokenSeries,
      recentLogs,
    },
  };
}

function tokensProvider(channelId: string): "claude" | "openai" {
  const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  return channel?.type ?? "openai";
}

function costFor(model: string, provider: "claude" | "openai", channelId: string, input: number, output: number, cacheRead: number, cacheCreate: number, prices: Map<string, Pick<typeof schema.modelPrices.$inferSelect, "inputPricePerMTok" | "outputPricePerMTok" | "cacheReadPricePerMTok" | "cacheCreationPricePerMTok">>, billingMultiplier: number) {
  const price = prices.get(`${channelId}:${model}`) ?? prices.get(`${provider}:${model}`);
  if (!price) return 0;
  return ((input / 1_000_000) * price.inputPricePerMTok
    + (output / 1_000_000) * price.outputPricePerMTok
    + (cacheRead / 1_000_000) * price.cacheReadPricePerMTok
    + (cacheCreate / 1_000_000) * price.cacheCreationPricePerMTok) * billingMultiplier;
}

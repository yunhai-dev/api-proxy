/**
 * 核心代理：鉴权 → 选渠道 → 转发 → 流式回传 → 记日志
 */

import { db, schema } from "./db";
import { and, eq, gte } from "drizzle-orm";
import { callUpstream, type Provider, type UpstreamOk } from "./upstream";
import { logHub } from "./log-generator";
import { acquireChannelSlot, isChannelSaturated } from "./channel-queue";
import { acquireKeySlot } from "./key-queue";
import { getSettingsAsync } from "./settings";
import { modelConfigAsync } from "./model-catalog";
import { recordChannelObservation } from "./channel-health";
import { effectiveUserLimits, effectiveUserLimitsAsync } from "./user-quota";
import { checkTpm, consumeRpm } from "./rate-limit";
import { usePostgres } from "./db/runtime";
import { appendModelVariant, modelLookupCandidates } from "./model-variants";
import { convertRequestBody, convertResponseBody, createSseResponseConverter } from "./protocol-conversion";

const MAX_LATENCY_MS = 60_000;
const NO_LIVE_CHANNEL_ERROR = "没有存活的渠道";

export type ResolveKey =
  | { ok: true; key: typeof schema.keys.$inferSelect }
  | { ok: false; status: 401 | 402 | 403 | 429; error: string };

export function resolveApiKey(rawAuth: string | null): ResolveKey {
  if (!rawAuth) return { ok: false, status: 401, error: "缺少 API 密钥（Authorization / x-api-key）" };
  const m = rawAuth.match(/^Bearer\s+(.+)$/i);
  return resolveToken((m ? m[1] : rawAuth).trim());
}

export async function resolveApiKeyAsync(rawAuth: string | null): Promise<ResolveKey> {
  if (!rawAuth) return { ok: false, status: 401, error: "缺少 API 密钥（Authorization / x-api-key）" };
  const m = rawAuth.match(/^Bearer\s+(.+)$/i);
  return resolveTokenAsync((m ? m[1] : rawAuth).trim());
}

export function resolveToken(token: string | null | undefined): ResolveKey {
  if (!token) return { ok: false, status: 401, error: "API 密钥为空" };

  // 优先按 prefix 查（避免展示完整 fullKey 时的匹配问题）
  const prefixMatch = token.match(/^(sk-relay-[a-zA-Z0-9]+)/);
  if (prefixMatch) {
    const key = db.select().from(schema.keys).where(eq(schema.keys.prefix, prefixMatch[1])).get();
    if (key) return checkKey(key, token);
  }
  // 兜底：按 fullKey
  const key = db.select().from(schema.keys).where(eq(schema.keys.fullKey, token)).get();
  if (key) return checkKey(key, token);
  return { ok: false, status: 401, error: "API 密钥无效" };
}

async function resolveTokenAsync(token: string | null | undefined): Promise<ResolveKey> {
  if (!usePostgres()) return resolveToken(token);
  if (!token) return { ok: false, status: 401, error: "API 密钥为空" };
  const { pgDb, pgSchema } = await import("./db/pg");
  const prefixMatch = token.match(/^(sk-relay-[a-zA-Z0-9]+)/);
  if (prefixMatch) {
    const key = (await pgDb.select().from(pgSchema.keys).where(eq(pgSchema.keys.prefix, prefixMatch[1])).limit(1))[0];
    if (key) return checkKey(key as typeof schema.keys.$inferSelect, token);
  }
  const key = (await pgDb.select().from(pgSchema.keys).where(eq(pgSchema.keys.fullKey, token)).limit(1))[0];
  if (key) return checkKey(key as typeof schema.keys.$inferSelect, token);
  return { ok: false, status: 401, error: "API 密钥无效" };
}

function checkKey(key: typeof schema.keys.$inferSelect, token: string): ResolveKey {
  if (key.status === "disabled") return { ok: false, status: 403, error: "密钥已停用" };
  if (key.quota > 0 && key.used >= key.quota) {
    return { ok: false, status: 429, error: "已超出当日配额" };
  }
  return { ok: true, key };
}

async function checkKeyRateLimit(key: typeof schema.keys.$inferSelect): Promise<Extract<ResolveKey, { ok: false }> | null> {
  if (key.rateLimitRpm <= 0 && key.rateLimitTpm <= 0) return null;
  const rpmOk = await consumeRpm("key", key.id, key.rateLimitRpm);
  if (rpmOk === false) return { ok: false, status: 429, error: "已超出每分钟请求限制" };
  const tpmOk = await checkTpm("key", key.id, key.rateLimitTpm);
  if (tpmOk === false) return { ok: false, status: 429, error: "已超出每分钟 Token 限制" };
  if (rpmOk !== null || tpmOk !== null) return null;
  const since = Date.now() - 60_000;
  const rows = usePostgres()
    ? await (async () => {
      const { pgDb, pgSchema } = await import("./db/pg");
      return pgDb.select({ tokensIn: pgSchema.requestLogs.tokensIn, tokensOut: pgSchema.requestLogs.tokensOut }).from(pgSchema.requestLogs).where(and(eq(pgSchema.requestLogs.keyId, key.id), gte(pgSchema.requestLogs.ts, since)));
    })()
    : db
      .select({ tokensIn: schema.requestLogs.tokensIn, tokensOut: schema.requestLogs.tokensOut })
      .from(schema.requestLogs)
      .where(and(eq(schema.requestLogs.keyId, key.id), gte(schema.requestLogs.ts, since)))
      .all();
  if (key.rateLimitRpm > 0 && rows.length >= key.rateLimitRpm) return { ok: false, status: 429, error: "已超出每分钟请求限制" };
  const tokens = rows.reduce((sum, row) => sum + row.tokensIn + row.tokensOut, 0);
  if (key.rateLimitTpm > 0 && tokens >= key.rateLimitTpm) return { ok: false, status: 429, error: "已超出每分钟 Token 限制" };
  return null;
}

async function checkUserQuota(key: typeof schema.keys.$inferSelect): Promise<Extract<ResolveKey, { ok: false }> | null> {
  if (!key.userId) return null;
  const quota = usePostgres()
    ? await (async () => {
      const { pgDb, pgSchema } = await import("./db/pg");
      return (await pgDb.select().from(pgSchema.userQuotas).where(eq(pgSchema.userQuotas.userId, key.userId)).limit(1))[0] as typeof schema.userQuotas.$inferSelect | undefined;
    })()
    : db.select().from(schema.userQuotas).where(eq(schema.userQuotas.userId, key.userId)).get();
  const limits = usePostgres() ? await effectiveUserLimitsAsync(quota) : effectiveUserLimits(quota);
  if (!quota || quota.quotaUsd <= 0 || quota.usedUsd >= quota.quotaUsd) return { ok: false, status: 402, error: "用户额度已用完，请续费" };
  if (limits.rateLimitRpm > 0 || limits.rateLimitTpm > 0) {
    const rpmOk = await consumeRpm("user", key.userId, limits.rateLimitRpm);
    if (rpmOk === false) return { ok: false, status: 429, error: "用户已超出每分钟请求限制" };
    const tpmOk = await checkTpm("user", key.userId, limits.rateLimitTpm);
    if (tpmOk === false) return { ok: false, status: 429, error: "用户已超出每分钟 Token 限制" };
    if (rpmOk !== null || tpmOk !== null) return null;
    const recent = usePostgres()
      ? await (async () => {
        const { pgDb, pgSchema } = await import("./db/pg");
        return pgDb
          .select({ keyId: pgSchema.requestLogs.keyId, tokensIn: pgSchema.requestLogs.tokensIn, tokensOut: pgSchema.requestLogs.tokensOut })
          .from(pgSchema.requestLogs)
          .innerJoin(pgSchema.keys, eq(pgSchema.keys.id, pgSchema.requestLogs.keyId))
          .where(and(eq(pgSchema.keys.userId, key.userId), gte(pgSchema.requestLogs.ts, Date.now() - 60_000)));
      })()
      : (() => {
        const keyIds = db.select({ id: schema.keys.id }).from(schema.keys).where(eq(schema.keys.userId, key.userId)).all().map(row => row.id);
        return db.select({ keyId: schema.requestLogs.keyId, tokensIn: schema.requestLogs.tokensIn, tokensOut: schema.requestLogs.tokensOut }).from(schema.requestLogs).where(gte(schema.requestLogs.ts, Date.now() - 60_000)).all().filter(row => keyIds.includes(row.keyId));
      })();
    if (limits.rateLimitRpm > 0 && recent.length >= limits.rateLimitRpm) return { ok: false, status: 429, error: "用户已超出每分钟请求限制" };
    const tokens = recent.reduce((sum, row) => sum + row.tokensIn + row.tokensOut, 0);
    if (limits.rateLimitTpm > 0 && tokens >= limits.rateLimitTpm) return { ok: false, status: 429, error: "用户已超出每分钟 Token 限制" };
  }
  return null;
}

async function userMaxConcurrency(userId: string) {
  if (!userId) return 0;
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("./db/pg");
    const quota = (await pgDb.select().from(pgSchema.userQuotas).where(eq(pgSchema.userQuotas.userId, userId)).limit(1))[0] as typeof schema.userQuotas.$inferSelect | undefined;
    return (await effectiveUserLimitsAsync(quota)).maxConcurrency;
  }
  return effectiveUserLimits(db.select().from(schema.userQuotas).where(eq(schema.userQuotas.userId, userId)).get()).maxConcurrency;
}

/* ============================================================
   渠道选择
   ============================================================ */

export type ChannelCandidate = typeof schema.channels.$inferSelect;

export function selectChannels(
  type: Provider,
  model: string | string[],
  exclude: Set<string> = new Set(),
): ChannelCandidate[] {
  const models = Array.isArray(model) ? model : [model];
  const rows = db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.type, type), eq(schema.channels.enabled, true)))
    .all();
  const matched = rows.filter(c => {
    if (exclude.has(c.id)) return false;
    if (c.models.length === 0) return true;            // 空数组 = 接受所有模型
    if (models.some(item => c.models.includes(item))) return true;
    if (c.models.includes("*")) return true;
    return false;
  });
  const healthy = matched.filter(c => c.status !== "err");
  return healthy.length ? healthy : matched;
}

export async function selectChannelsAsync(
  type: Provider,
  model: string | string[],
  exclude: Set<string> = new Set(),
): Promise<ChannelCandidate[]> {
  if (!usePostgres()) return selectChannels(type, model, exclude);
  const models = Array.isArray(model) ? model : [model];
  const { pgDb, pgSchema } = await import("./db/pg");
  const rows = await pgDb.select().from(pgSchema.channels).where(and(eq(pgSchema.channels.type, type), eq(pgSchema.channels.enabled, true)));
  const matched = (rows as ChannelCandidate[]).filter(c => {
    if (exclude.has(c.id)) return false;
    if (c.models.length === 0) return true;
    if (models.some(item => c.models.includes(item))) return true;
    if (c.models.includes("*")) return true;
    return false;
  });
  const healthy = matched.filter(c => c.status !== "err");
  return healthy.length ? healthy : matched;
}

function pickPriorityRandom(channels: ChannelCandidate[]): ChannelCandidate | null {
  if (!channels.length) return null;
  // Highest weight is the priority tier; random within the tier provides load balancing.
  const maxWeight = Math.max(...channels.map(c => c.weight));
  const top = channels.filter(c => c.weight === maxWeight);
  return top[Math.floor(Math.random() * top.length)] ?? top[0];
}

function applyMappedChannelScope(channels: ChannelCandidate[], channelIds: string[] | undefined): ChannelCandidate[] {
  if (!channelIds?.length) return channels;
  const allowed = new Set(channelIds);
  return channels.filter(channel => allowed.has(channel.id));
}

/* ============================================================
   代理执行
   ============================================================ */

export type ProxyRequest = {
  type: Provider;
  openAiEndpoint?: "chat_completions" | "responses";
  body: string;
  requestHeaders?: Headers;
  stream: boolean;
  rawAuth: string | null;
  signal?: AbortSignal;
  incomingHeaders?: Headers;
};

export type ProxyResult =
  | { kind: "success"; requestId: string; response: Response; logged: { status: number; latencyMs: number; tokensIn: number; tokensOut: number; cacheTokens: number; cacheReadTokens: number; cacheCreationTokens: number; channelId: string; channelName: string } }
  | { kind: "client_error"; requestId: string; status: 400 | 401 | 402 | 403 | 404 | 429; error: string }
  | { kind: "upstream_error"; requestId: string; status: number; error: string; attempts: { channel: string; error: string; status: number }[] };

const MAX_LOG_BODY_CHARS = 64 * 1024;
const MAX_SSE_USAGE_BUFFER_CHARS = 256 * 1024;

function truncateLogText(value: string) {
  if (value.length <= MAX_LOG_BODY_CHARS) return value;
  return `${value.slice(0, MAX_LOG_BODY_CHARS)}\n...[truncated ${value.length - MAX_LOG_BODY_CHARS} chars]`;
}

function appendCapped(current: string, chunk: string, maxChars: number) {
  const next = current + chunk;
  return next.length > maxChars ? next.slice(next.length - maxChars) : next;
}

function failureDetail(input: {
  requestId: string;
  type: Provider;
  status: number;
  error: string;
  model?: string;
  inboundModel?: string;
  upstreamModel?: string;
  keyPrefix?: string;
  channelName?: string;
  attempts?: { channel: string; error: string; status: number }[];
  body: string;
}) {
  return JSON.stringify({
    request_id: input.requestId,
    type: input.type,
    status: input.status,
    error: input.error,
    model: input.model || null,
    inbound_model: input.inboundModel || input.model || null,
    upstream_model: input.upstreamModel || input.model || null,
    key_prefix: input.keyPrefix || null,
    channel: input.channelName || null,
    attempts: input.attempts ?? [],
    body: truncateLogText(input.body),
  });
}

async function requestDetail(input: {
  requestId: string;
  type: Provider;
  status: number;
  inboundModel: string;
  upstreamModel: string;
  channelName?: string;
  requestHeaders?: Headers;
  requestBody: string;
  responseBody?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}) {
  const settings = await getSettingsAsync();
  if (!settings.recordAllRequestDetails) return null;
  return JSON.stringify({
    request_id: input.requestId,
    type: input.type,
    status: input.status,
    inbound_model: input.inboundModel,
    upstream_model: input.upstreamModel,
    channel: input.channelName ?? null,
    request_headers: sanitizeHeaders(input.requestHeaders),
    request_body: truncateLogText(input.requestBody),
    response_body: input.responseBody == null ? null : truncateLogText(input.responseBody),
    tokens: {
      input: input.tokensIn ?? 0,
      output: input.tokensOut ?? 0,
      cache_read: input.cacheReadTokens ?? 0,
      cache_creation: input.cacheCreationTokens ?? 0,
    },
  });
}

function sanitizeHeaders(headers?: Headers) {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    const k = key.toLowerCase();
    out[k] = k.includes("key") || k.includes("auth") ? "[redacted]" : value;
  }
  return out;
}

async function recordFailure(input: {
  requestId: string;
  ts: number;
  type: Provider;
  status: number;
  error: string;
  body: string;
  requestHeaders?: Headers;
  model?: string;
  inboundModel?: string;
  upstreamModel?: string;
  mappingId?: string;
  mappedChannelIds?: string[];
  key?: typeof schema.keys.$inferSelect;
  channel?: ChannelCandidate;
  attempts?: { channel: string; error: string; status: number }[];
}) {
  const latency = Date.now() - input.ts;
  await logHub.recordAsync({
    requestId: input.requestId,
    ts: input.ts,
    keyId: input.key?.id ?? "",
    keyName: input.key?.name ?? "未认证",
    keyPrefix: input.key?.prefix ?? "—",
    channelId: input.channel?.id ?? "",
    channelName: input.channel?.name ?? "未选择",
    channelType: input.channel?.type ?? input.type,
    model: input.model || "—",
    inboundModel: input.inboundModel || input.model || "—",
    upstreamModel: input.upstreamModel || input.model || "—",
    mappingId: input.mappingId || "",
    mappedChannelIds: input.mappedChannelIds ?? [],
    status: input.status,
    latencyMs: latency,
    ttftMs: latency,
    durationMs: latency,
    tokensIn: 0,
    tokensOut: 0,
    cacheTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    requestDetail: await requestDetail({ requestId: input.requestId, type: input.type, status: input.status, inboundModel: input.inboundModel || input.model || "—", upstreamModel: input.upstreamModel || input.model || "—", channelName: input.channel?.name, requestHeaders: input.requestHeaders, requestBody: input.body }),
    errorMsg: failureDetail({
      requestId: input.requestId,
      type: input.type,
      status: input.status,
      error: input.error,
      model: input.model,
      inboundModel: input.inboundModel,
      upstreamModel: input.upstreamModel,
      keyPrefix: input.key?.prefix,
      channelName: input.channel?.name,
      attempts: input.attempts,
      body: input.body,
    }),
  });
}

function modelMapping(provider: Provider, model: string) {
  const mapping = db
    .select()
    .from(schema.modelMappings)
    .where(and(eq(schema.modelMappings.provider, provider), eq(schema.modelMappings.inboundModel, model)))
    .get();
  return mapping ?? null;
}

async function modelMappingAsync(provider: Provider, model: string) {
  if (!usePostgres()) return modelMapping(provider, model);
  const { pgDb, pgSchema } = await import("./db/pg");
  return (await pgDb
    .select()
    .from(pgSchema.modelMappings)
    .where(and(eq(pgSchema.modelMappings.provider, provider), eq(pgSchema.modelMappings.inboundModel, model)))
    .limit(1))[0] ?? null;
}

async function modelMappingCandidateAsync(provider: Provider, models: string[]) {
  for (const model of models) {
    const mapping = await modelMappingAsync(provider, model);
    if (mapping) return { mapping, matchedModel: model };
  }
  return { mapping: null, matchedModel: "" };
}

async function modelConfigCandidateAsync(provider: Provider, models: string[]) {
  for (const model of models) {
    const catalog = await modelConfigAsync(provider, model);
    if (catalog) return { catalog, matchedModel: model };
  }
  return { catalog: null, matchedModel: "" };
}

function upstreamModelError(model: string) {
  return `不支持模型 ${model}`;
}

function unsupportedModelMessage(status: number, error: string, model: string) {
  if (status !== 400 && status !== 404) return error;
  const lower = error.toLowerCase();
  if (lower.includes("tools") || lower.includes("tool")) return error;
  const isModelError = lower.includes("model") || error.includes("模型");
  const isUnsupported = /not found|not supported|unsupported|does not exist|invalid|不存在|不支持|无效/i.test(error);
  return isModelError && isUnsupported ? upstreamModelError(model) : error;
}

function bodyWithModel(body: string, model: string) {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return JSON.stringify({ ...parsed, model });
  } catch {
    return body;
  }
}

/**
 * 单次代理调用。
 * - 解析 API key
 * - 解析 model
 * - 选渠道（按权重）→ 调上游
 * - 失败按 429/5xx/网络错 自动 fallback，最多 MAX_RETRIES 次
 * - 成功：stream 直接透传，非 stream 收集后回
 * - 任何时候都记一条日志
 */
export async function proxyOnce(req: ProxyRequest): Promise<ProxyResult> {
  const t0 = Date.now();
  const settings = await getSettingsAsync();
  const requestId = req.incomingHeaders?.get("x-request-id")
    ?? req.incomingHeaders?.get("request-id")
    ?? crypto.randomUUID();

  if (settings.maintenanceMode) {
    const message = settings.maintenanceMessage.trim() || "系统维护中，请稍后再试。";
    await recordFailure({ requestId, ts: t0, type: req.type, status: 503, error: message, body: req.body, requestHeaders: req.incomingHeaders, model: extractModel(req.body) ?? undefined });
    return { kind: "upstream_error", requestId, status: 503, error: message, attempts: [] };
  }

  // 1) 解析 key
  const resolved = await resolveApiKeyAsync(req.rawAuth);
  if (!resolved.ok) {
    await recordFailure({ requestId, ts: t0, type: req.type, status: resolved.status, error: resolved.error, body: req.body, requestHeaders: req.incomingHeaders, model: extractModel(req.body) ?? undefined });
    return { kind: "client_error", requestId, status: resolved.status, error: resolved.error };
  }
  const key = resolved.key;
  const userLimited = await checkUserQuota(key);
  if (userLimited) {
    await recordFailure({ requestId, ts: t0, type: req.type, status: userLimited.status, error: userLimited.error, body: req.body, requestHeaders: req.incomingHeaders, model: extractModel(req.body) ?? undefined, key });
    return { kind: "client_error", requestId, status: userLimited.status, error: userLimited.error };
  }
  const rateLimited = await checkKeyRateLimit(key);
  if (rateLimited) {
    await recordFailure({ requestId, ts: t0, type: req.type, status: rateLimited.status, error: rateLimited.error, body: req.body, requestHeaders: req.incomingHeaders, model: extractModel(req.body) ?? undefined, key });
    return { kind: "client_error", requestId, status: rateLimited.status, error: rateLimited.error };
  }
  const releaseUserSlot = await acquireKeySlot(`user:${key.userId}`, await userMaxConcurrency(key.userId));
  const releaseKeySlot = await acquireKeySlot(key.id, key.maxConcurrency ?? 0);
  const releaseAllKeySlots = () => { releaseKeySlot(); releaseUserSlot(); };

  // 2) 解析 body / model
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(req.body); }
  catch {
    await recordFailure({ requestId, ts: t0, type: req.type, status: 400, error: "body 不是合法 JSON", body: req.body, requestHeaders: req.incomingHeaders, key });
    releaseAllKeySlots();
    return { kind: "client_error", requestId, status: 400, error: "body 不是合法 JSON" };
  }

  const model = typeof parsed.model === "string" ? parsed.model : "";
  if (!model) {
    await recordFailure({ requestId, ts: t0, type: req.type, status: 400, error: "缺少 model 字段", body: req.body, requestHeaders: req.incomingHeaders, key });
    releaseAllKeySlots();
    return { kind: "client_error", requestId, status: 400, error: "缺少 model 字段" };
  }
  const modelCandidates = modelLookupCandidates(model);
  const { mapping, matchedModel: mappingMatchedModel } = await modelMappingCandidateAsync(req.type, modelCandidates);
  const { catalog } = await modelConfigCandidateAsync(req.type, modelCandidates);
  if (catalog && !catalog.enabled) {
    await recordFailure({ requestId, ts: t0, type: req.type, status: 403, error: "模型已停用", body: req.body, requestHeaders: req.incomingHeaders, model, inboundModel: model, upstreamModel: mapping?.upstreamModel || model, mappingId: mapping?.id, mappedChannelIds: mapping?.channelIds ?? [], key });
    releaseAllKeySlots();
    return { kind: "client_error", requestId, status: 403, error: "模型已停用" };
  }
  const targetProvider = (mapping?.targetProvider ?? req.type) as Provider;
  const upstreamModel = mapping ? appendModelVariant(model, mappingMatchedModel, mapping.upstreamModel) : model;
  const upstreamModelCandidates = modelLookupCandidates(upstreamModel);
  const { catalog: upstreamCatalog } = upstreamModel === model && targetProvider === req.type ? { catalog: null } : await modelConfigCandidateAsync(targetProvider, upstreamModelCandidates);
  if (upstreamCatalog && !upstreamCatalog.enabled) {
    await recordFailure({ requestId, ts: t0, type: req.type, status: 403, error: "映射模型已停用", body: req.body, requestHeaders: req.incomingHeaders, model: upstreamModel, inboundModel: model, upstreamModel, mappingId: mapping?.id, mappedChannelIds: mapping?.channelIds ?? [], key });
    releaseAllKeySlots();
    return { kind: "client_error", requestId, status: 403, error: "映射模型已停用" };
  }
  let convertedBody: string;
  try {
    convertedBody = JSON.stringify(convertRequestBody({ sourceType: req.type, targetType: targetProvider, body: parsed, model: upstreamModel, stream: req.stream }));
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    await recordFailure({ requestId, ts: t0, type: req.type, status: 400, error, body: req.body, requestHeaders: req.incomingHeaders, model, inboundModel: model, upstreamModel, mappingId: mapping?.id, mappedChannelIds: mapping?.channelIds ?? [], key });
    releaseAllKeySlots();
    return { kind: "client_error", requestId, status: 400, error };
  }
  const upstreamBody = req.stream && targetProvider === "openai" && req.openAiEndpoint !== "responses" ? withOpenAiStreamUsage(convertedBody) : convertedBody;

  // 3) 选渠道
  const candidates = applyMappedChannelScope(
    await selectChannelsAsync(targetProvider, upstreamModelCandidates),
    mapping?.channelIds,
  );
  if (candidates.length === 0) {
    const error = upstreamModelError(upstreamModel);
    await recordFailure({ requestId, ts: t0, type: req.type, status: 404, error, body: req.body, requestHeaders: req.incomingHeaders, model: upstreamModel, inboundModel: model, upstreamModel, mappingId: mapping?.id, mappedChannelIds: mapping?.channelIds ?? [], key });
    releaseAllKeySlots();
    return { kind: "client_error", requestId, status: 404, error };
  }

  // 4) 转发（带重试）
  const attempts: { channel: string; error: string; status: number }[] = [];
  const tried = new Set<string>();
  const attemptCounts = new Map<string, number>();
  let retryChannel: ChannelCandidate | null = null;
  let lastError = "";
  let lastStatus = 0;
  let lastChannel: ChannelCandidate | undefined;

  for (let i = 0; i < settings.proxyMaxRetries; i++) {
    const freshPool = candidates.filter(c => !tried.has(c.id));
    const pool = retryChannel ? [retryChannel] : freshPool.length ? freshPool : candidates;
    const saturation = await Promise.all(pool.map(async c => [c.id, await isChannelSaturated(c.id, c.maxConcurrency ?? 0)] as const));
    const saturatedIds = new Set(saturation.filter(([, saturated]) => saturated).map(([id]) => id));
    const availablePool = pool.filter(c => !saturatedIds.has(c.id));
    const ch = pickPriorityRandom(availablePool.length ? availablePool : pool);
    if (!ch) break;
    retryChannel = null;
	    lastChannel = ch;

	    const releaseSlot = await acquireChannelSlot(ch.id, ch.maxConcurrency ?? 0);
    const attemptStart = Date.now();
	    const result = await callUpstream({
      channelType: targetProvider,
      openAiEndpoint: targetProvider === "openai" ? req.openAiEndpoint : undefined,
      baseUrl: ch.baseUrl,
      upstreamKey: ch.apiKey,
      model: upstreamModel,
      body: upstreamBody,
      stream: req.stream,
      signal: req.signal,
      timeoutMs: MAX_LATENCY_MS,
    });

	    if (result.ok) {
      await recordChannelObservation(ch, { ok: true, latencyMs: Date.now() - attemptStart });
	      const latency = Date.now() - t0;
      // 5) 处理响应
      if (req.stream) {
        const logged = await pipeStreamResponse(result, {
          key, channel: ch, model: upstreamModel, inboundModel: model, upstreamModel, mappingId: mapping?.id ?? "", mappedChannelIds: mapping?.channelIds ?? [], t0, type: req.type, targetType: targetProvider, requestId, body: req.body, requestHeaders: req.incomingHeaders, releaseSlot: () => { releaseSlot(); releaseAllKeySlots(); },
        });
        return { kind: "success", requestId, response: logged.response, logged: { ...logged.info, channelId: ch.id, channelName: ch.name } };
      } else {
        const logged = await collectResponse(result, {
          key, channel: ch, model: upstreamModel, inboundModel: model, upstreamModel, mappingId: mapping?.id ?? "", mappedChannelIds: mapping?.channelIds ?? [], t0, type: req.type, targetType: targetProvider, requestId, body: req.body, requestHeaders: req.incomingHeaders,
        }).finally(() => { releaseSlot(); releaseAllKeySlots(); });
        return { kind: "success", requestId, response: logged.response, logged: { ...logged.info, channelId: ch.id, channelName: ch.name } };
      }
    }

	    releaseSlot();
	    const observed = await recordChannelObservation(ch, {
      ok: false,
      latencyMs: Date.now() - attemptStart,
      error: result.errorMsg,
    }, { failureStatus: result.status === 429 ? "warn" : "err" });
    ch.status = observed.status;

    attempts.push({ channel: ch.name, error: result.errorMsg, status: result.status });
    lastError = `${ch.name}: ${result.errorMsg}`;
    lastStatus = result.status;
    const count = (attemptCounts.get(ch.id) ?? 0) + 1;
    attemptCounts.set(ch.id, count);
    if (count < 2 && i + 1 < settings.proxyMaxRetries) {
      retryChannel = ch;
    } else {
      tried.add(ch.id);
    }
  }

  // 全部失败
  const finalStatus = lastStatus > 0 ? lastStatus : 502;
  const finalError = lastError
    ? unsupportedModelMessage(lastStatus, lastError, upstreamModel)
    : NO_LIVE_CHANNEL_ERROR;
  await recordFailure({ requestId, ts: t0, type: req.type, status: finalStatus, error: finalError, body: req.body, requestHeaders: req.incomingHeaders, model: upstreamModel, inboundModel: model, upstreamModel, mappingId: mapping?.id, mappedChannelIds: mapping?.channelIds ?? [], key, channel: lastChannel, attempts });
  releaseAllKeySlots();
  return {
    kind: "upstream_error",
    requestId,
    status: finalStatus,
    error: finalError,
    attempts,
  };
}

/* ============================================================
   响应处理：stream 与非 stream
   ============================================================ */

type Ctx = {
  requestId: string;
  key: typeof schema.keys.$inferSelect;
  channel: ChannelCandidate;
  model: string;
  inboundModel: string;
  upstreamModel: string;
  mappingId: string;
  mappedChannelIds: string[];
  t0: number;
  type: Provider;
  targetType: Provider;
  body: string;
  requestHeaders?: Headers;
  releaseSlot?: () => void;
};

async function pipeStreamResponse(
  upstream: UpstreamOk,
  ctx: Ctx,
): Promise<{ response: Response; info: { status: number; latencyMs: number; tokensIn: number; tokensOut: number; cacheTokens: number; cacheReadTokens: number; cacheCreationTokens: number } }> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = upstream.body.getReader();
  const streamConverter = createSseResponseConverter({ sourceType: ctx.type, targetType: ctx.targetType, model: ctx.inboundModel });
  let buffer = "";
  let detailBuffer = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let ttftMs = 0;
  let upstreamStatus = upstream.status;
  let cancelled = false;
  let logged = false;
  let released = false;
  const startLatency = Date.now() - ctx.t0;
  const initialLog = await logHub.recordAsync({
    requestId: ctx.requestId,
    ts: ctx.t0, keyId: ctx.key.id, keyName: ctx.key.name, keyPrefix: ctx.key.prefix,
    channelId: ctx.channel.id, channelName: ctx.channel.name, channelType: ctx.channel.type,
    model: ctx.model, status: upstreamStatus, latencyMs: startLatency,
    inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, mappingId: ctx.mappingId, mappedChannelIds: ctx.mappedChannelIds,
    ttftMs: 0, durationMs: 0,
    tokensIn: 0, tokensOut: 0, cacheTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    requestDetail: await requestDetail({ requestId: ctx.requestId, type: ctx.type, status: upstreamStatus, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders, requestBody: ctx.body }),
    errorMsg: null,
  });

  function isAbortLike(msg: string) {
    const s = msg.toLowerCase();
    return s.includes("abort") || s.includes("cancel") || s.includes("invalid state");
  }

  function isUpstreamDisconnect(msg: string) {
    const s = msg.toLowerCase();
    return s.includes("terminated") || s.includes("socket") || s.includes("econnreset") || s.includes("other side closed");
  }

  async function recordUpstreamDisconnect(latency: number, errorMsg: string) {
    await recordChannelObservation(ctx.channel, {
      ok: false,
      latencyMs: latency,
      error: errorMsg,
    }, { failureStatus: "err" });
  }

  async function record(status: number, latency: number, errorMsg: string | null) {
    if (logged) return;
    logged = true;
    const detail = errorMsg
      ? failureDetail({
        requestId: ctx.requestId,
        type: ctx.type,
        status,
        error: errorMsg,
        model: ctx.model,
        inboundModel: ctx.inboundModel,
        upstreamModel: ctx.upstreamModel,
        keyPrefix: ctx.key.prefix,
        channelName: ctx.channel.name,
        body: ctx.body,
      })
      : null;
    await logHub.updateAsync(initialLog.id, {
      requestId: ctx.requestId,
      ts: ctx.t0, keyId: ctx.key.id, keyName: ctx.key.name, keyPrefix: ctx.key.prefix,
      channelId: ctx.channel.id, channelName: ctx.channel.name, channelType: ctx.channel.type,
      model: ctx.model, status, latencyMs: latency,
      inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, mappingId: ctx.mappingId, mappedChannelIds: ctx.mappedChannelIds,
      ttftMs: ttftMs || latency, durationMs: latency,
      tokensIn, tokensOut, cacheTokens, cacheReadTokens, cacheCreationTokens,
      requestDetail: await requestDetail({ requestId: ctx.requestId, type: ctx.type, status, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders, requestBody: ctx.body, responseBody: detailBuffer, tokensIn, tokensOut, cacheReadTokens, cacheCreationTokens }),
      errorMsg: detail,
    });
    releaseSlot();
  }

  function releaseSlot() {
    if (released) return;
    released = true;
    ctx.releaseSlot?.();
  }

  // 透传响应头（去 hop-by-hop）
  const outHeaders = new Headers();
  outHeaders.set("content-type", streamConverter ? "text/event-stream" : upstream.contentType);
  outHeaders.set("cache-control", "no-cache");
  outHeaders.set("x-accel-buffering", "no");
  outHeaders.set("x-proxy-channel-id", ctx.channel.id);
  outHeaders.set("x-proxy-model", ctx.model);
  outHeaders.set("x-request-id", ctx.requestId);

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          const latency = Date.now() - ctx.t0;
          if (streamConverter) {
            const finalText = streamConverter(dec.decode(), true);
            if (finalText) controller.enqueue(enc.encode(finalText));
          }
          try { controller.close(); } catch { /* client already closed */ }
          if (!cancelled) await record(upstreamStatus, latency, null);
          return;
        }
        // 解析 SSE 累计 token（不破坏原始字节，直接 enqueue）
        if (!ttftMs) {
          ttftMs = Date.now() - ctx.t0;
          void (async () => logHub.updateAsync(initialLog.id, {
            requestId: ctx.requestId,
            ts: ctx.t0, keyId: ctx.key.id, keyName: ctx.key.name, keyPrefix: ctx.key.prefix,
            channelId: ctx.channel.id, channelName: ctx.channel.name, channelType: ctx.channel.type,
            model: ctx.model, status: upstreamStatus, latencyMs: ttftMs,
            inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, mappingId: ctx.mappingId, mappedChannelIds: ctx.mappedChannelIds,
            ttftMs, durationMs: 0,
            tokensIn, tokensOut, cacheTokens, cacheReadTokens, cacheCreationTokens,
            requestDetail: await requestDetail({ requestId: ctx.requestId, type: ctx.type, status: upstreamStatus, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders, requestBody: ctx.body, tokensIn, tokensOut, cacheReadTokens, cacheCreationTokens }),
            errorMsg: null,
          }))().catch(() => { /* keep stream delivery independent from logging */ });
        }
        const text = dec.decode(value, { stream: true });
        buffer = appendCapped(buffer, text, MAX_SSE_USAGE_BUFFER_CHARS);
        detailBuffer = appendCapped(detailBuffer, text, MAX_LOG_BODY_CHARS);
        const parsed = parseSseUsage(buffer, ctx.targetType);
        if (parsed) {
          tokensIn = parsed.in;
          tokensOut = parsed.out;
          cacheReadTokens = parsed.cacheRead;
          cacheCreationTokens = parsed.cacheCreation;
          cacheTokens = parsed.cacheRead + parsed.cacheCreation;
        }
        if (streamConverter) {
          const converted = streamConverter(text);
          if (converted) controller.enqueue(enc.encode(converted));
        } else {
          controller.enqueue(value);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const latency = Date.now() - ctx.t0;
        if (cancelled || isAbortLike(msg)) {
          await record(499, latency, cancelled ? "客户端取消/连接中断" : `客户端取消/连接中断：${msg}`);
          return;
        }
        if (isUpstreamDisconnect(msg)) {
          const errorMsg = `上游流式响应中断：${msg}`;
          await recordUpstreamDisconnect(latency, errorMsg);
          await record(502, latency, errorMsg);
          try { controller.error(e); } catch { /* client already closed */ }
          return;
        }
        await record(0, latency, msg);
        try { controller.error(e); } catch { /* */ }
      }
    },
    cancel() {
      cancelled = true;
      try { reader.cancel(); } catch { /* */ }
      void record(499, Date.now() - ctx.t0, "客户端取消/连接中断");
    },
  });

  return {
    response: new Response(stream, { status: upstreamStatus, headers: outHeaders }),
    info: { status: upstreamStatus, latencyMs: Date.now() - ctx.t0, tokensIn, tokensOut, cacheTokens, cacheReadTokens, cacheCreationTokens },
  };
}

async function collectResponse(
  upstream: UpstreamOk,
  ctx: Ctx,
): Promise<{ response: Response; info: { status: number; latencyMs: number; tokensIn: number; tokensOut: number; cacheTokens: number; cacheReadTokens: number; cacheCreationTokens: number } }> {
  const text = await streamToString(upstream.body);
  const latency = Date.now() - ctx.t0;
  const usage = extractUsage(text, ctx.targetType);
  let responseText = text;
  let responseContentType = upstream.contentType;
  if (ctx.type !== ctx.targetType) {
    responseText = convertResponseBody({ sourceType: ctx.type, targetType: ctx.targetType, body: text, model: ctx.inboundModel });
    responseContentType = "application/json";
  }
  await logHub.recordAsync({
    requestId: ctx.requestId,
    ts: ctx.t0, keyId: ctx.key.id, keyName: ctx.key.name, keyPrefix: ctx.key.prefix,
    channelId: ctx.channel.id, channelName: ctx.channel.name, channelType: ctx.channel.type,
    model: ctx.model, status: upstream.status, latencyMs: latency,
    inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, mappingId: ctx.mappingId, mappedChannelIds: ctx.mappedChannelIds,
    ttftMs: latency, durationMs: latency,
    tokensIn: usage.in, tokensOut: usage.out,
    cacheTokens: usage.cacheRead + usage.cacheCreation,
    cacheReadTokens: usage.cacheRead,
    cacheCreationTokens: usage.cacheCreation,
    requestDetail: await requestDetail({ requestId: ctx.requestId, type: ctx.type, status: upstream.status, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders, requestBody: ctx.body, responseBody: responseText, tokensIn: usage.in, tokensOut: usage.out, cacheReadTokens: usage.cacheRead, cacheCreationTokens: usage.cacheCreation }),
    errorMsg: null,
  });

  const outHeaders = new Headers();
  outHeaders.set("content-type", responseContentType);
  outHeaders.set("x-proxy-channel-id", ctx.channel.id);
  outHeaders.set("x-proxy-model", ctx.model);
  outHeaders.set("x-request-id", ctx.requestId);

  return {
    response: new Response(responseText, { status: upstream.status, headers: outHeaders }),
    info: { status: upstream.status, latencyMs: latency, tokensIn: usage.in, tokensOut: usage.out, cacheTokens: usage.cacheRead + usage.cacheCreation, cacheReadTokens: usage.cacheRead, cacheCreationTokens: usage.cacheCreation },
  };
}

/* ============================================================
   工具：SSE usage 解析（Anthropic + OpenAI）
   ============================================================ */

type UsageTokens = { in: number; out: number; cacheRead: number; cacheCreation: number };

function parseSseUsage(buffer: string, type: Provider): UsageTokens | null {
  if (type === "claude") {
    // 累积所有 event 块中的 usage
    let input = 0, output = 0, cacheRead = 0, cacheCreation = 0;
    const eventRe = /^data: (.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = eventRe.exec(buffer)) !== null) {
      try {
        const d = JSON.parse(m[1]);
        if (d.type === "message_start" && d.message?.usage) {
          const usage = claudeUsageTokens(d.message.usage, { in: input, out: output, cacheRead, cacheCreation });
          input = usage.in;
          output = usage.out;
          cacheRead = usage.cacheRead;
          cacheCreation = usage.cacheCreation;
        }
        if (d.type === "message_delta" && d.usage) {
          const usage = claudeUsageTokens(d.usage, { in: input, out: output, cacheRead, cacheCreation });
          input = usage.in;
          output = usage.out;
          cacheRead = usage.cacheRead;
          cacheCreation = usage.cacheCreation;
        }
      } catch { /* */ }
    }
    return input > 0 || output > 0 || cacheRead > 0 || cacheCreation > 0 ? { in: input, out: output, cacheRead, cacheCreation } : null;
  }
  // OpenAI: 最后一块含 usage
  const lines = buffer.split("\n");
  let input = 0, output = 0, cacheRead = 0, found = false;
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") continue;
    try {
      const d = JSON.parse(data);
      const usage = openAiUsagePayload(d);
      if (usage) {
        found = true;
        input = openAiInputTokens(usage, input);
        output = openAiOutputTokens(usage, output);
        cacheRead = openAiCacheReadTokens(usage, cacheRead);
      }
    } catch { /* */ }
  }
  return found ? { in: input, out: output, cacheRead, cacheCreation: 0 } : null;
}

function extractUsage(body: string, type: Provider): UsageTokens {
  try {
    const d = JSON.parse(body);
    if (type === "claude") {
      const u = d.usage;
      if (u) return claudeUsageTokens(u);
    } else {
      const u = openAiUsagePayload(d);
      if (u) return { in: openAiInputTokens(u), out: openAiOutputTokens(u), cacheRead: openAiCacheReadTokens(u), cacheCreation: 0 };
    }
  } catch { /* */ }
  return { in: 0, out: 0, cacheRead: 0, cacheCreation: 0 };
}

function num(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function claudeUsageTokens(usage: Record<string, unknown>, fallback: UsageTokens = { in: 0, out: 0, cacheRead: 0, cacheCreation: 0 }): UsageTokens {
  const hasInput = hasToken(usage, "input_tokens") || hasToken(usage, "cache_read_input_tokens") || hasToken(usage, "cache_creation_input_tokens");
  const cacheRead = hasInput ? num(usage.cache_read_input_tokens) : fallback.cacheRead;
  const cacheCreation = hasInput ? num(usage.cache_creation_input_tokens) : fallback.cacheCreation;
  const input = hasInput ? num(usage.input_tokens) : fallback.in;
  const output = num(usage.output_tokens, fallback.out);
  return { in: input, out: output, cacheRead, cacheCreation };
}

function hasToken(usage: Record<string, unknown>, key: string) {
  const value = usage[key];
  return typeof value === "number" || typeof value === "string";
}

function openAiUsagePayload(body: Record<string, unknown>): Record<string, unknown> | null {
  if (body.usage && typeof body.usage === "object") return body.usage as Record<string, unknown>;
  const response = body.response;
  if (response && typeof response === "object") {
    const usage = (response as Record<string, unknown>).usage;
    if (usage && typeof usage === "object") return usage as Record<string, unknown>;
  }
  return null;
}

function openAiCacheReadTokens(usage: Record<string, unknown>, fallback = 0) {
  const details = usage.prompt_tokens_details ?? usage.input_tokens_details;
  if (!details || typeof details !== "object") return fallback;
  return num((details as Record<string, unknown>).cached_tokens, fallback);
}

function openAiInputTokens(usage: Record<string, unknown>, fallback = 0) {
  if (hasToken(usage, "input_tokens")) return Math.max(0, num(usage.input_tokens) - openAiCacheReadTokens(usage));
  if (!hasToken(usage, "prompt_tokens")) return fallback;
  return Math.max(0, num(usage.prompt_tokens) - openAiCacheReadTokens(usage));
}

function openAiOutputTokens(usage: Record<string, unknown>, fallback = 0) {
  if (hasToken(usage, "output_tokens")) return num(usage.output_tokens, fallback);
  return num(usage.completion_tokens, fallback);
}

function withOpenAiStreamUsage(body: string) {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const streamOptions = typeof parsed.stream_options === "object" && parsed.stream_options !== null
      ? { ...(parsed.stream_options as Record<string, unknown>) }
      : {};
    streamOptions.include_usage = true;
    return JSON.stringify({ ...parsed, stream_options: streamOptions });
  } catch {
    return body;
  }
}

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

/* ============================================================
   工具：从入站 body 提取 model
   ============================================================ */
export function extractModel(body: string): string | null {
  try {
    const d = JSON.parse(body);
    return typeof d.model === "string" ? d.model : null;
  } catch { return null; }
}

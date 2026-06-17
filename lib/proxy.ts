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
const USER_UPSTREAM_ERROR = "平台暂时无法处理请求，请稍后重试";

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
export type MappingCandidate = typeof schema.modelMappings.$inferSelect;

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

type RouteCandidate = {
  channel: ChannelCandidate;
  targetProvider: Provider;
  upstreamModel: string;
  mapping: MappingCandidate | null;
  mappedChannelIds: string[];
};

function pickRoutePriorityRandom(routes: RouteCandidate[]): RouteCandidate | null {
  if (!routes.length) return null;
  const maxWeight = Math.max(...routes.map(route => route.channel.weight));
  const top = routes.filter(route => route.channel.weight === maxWeight);
  return top[Math.floor(Math.random() * top.length)] ?? top[0];
}

function routeKey(route: RouteCandidate) {
  return `${route.channel.id}:${route.mapping?.id ?? "direct"}:${route.targetProvider}:${route.upstreamModel}`;
}

function applyMappedChannelScope(channels: ChannelCandidate[], channelIds: string[] | undefined): ChannelCandidate[] {
  if (!channelIds?.length) return channels;
  const allowed = new Set(channelIds);
  return channels.filter(channel => allowed.has(channel.id));
}

async function channelByIdAsync(id: string): Promise<ChannelCandidate | null> {
  if (!id) return null;
  if (!usePostgres()) return db.select().from(schema.channels).where(eq(schema.channels.id, id)).get() ?? null;
  const { pgDb, pgSchema } = await import("./db/pg");
  return (await pgDb.select().from(pgSchema.channels).where(eq(pgSchema.channels.id, id)).limit(1))[0] as ChannelCandidate | undefined ?? null;
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
  fallbackReason?: string;
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
    fallback: input.fallbackReason ? { reason: input.fallbackReason } : null,
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

function modelMappings(provider: Provider, model: string): MappingCandidate[] {
  return db
    .select()
    .from(schema.modelMappings)
    .where(and(eq(schema.modelMappings.provider, provider), eq(schema.modelMappings.inboundModel, model)))
    .all() as MappingCandidate[];
}

async function modelMappingsAsync(provider: Provider, model: string): Promise<MappingCandidate[]> {
  if (!usePostgres()) return modelMappings(provider, model);
  const { pgDb, pgSchema } = await import("./db/pg");
  return await pgDb
    .select()
    .from(pgSchema.modelMappings)
    .where(and(eq(pgSchema.modelMappings.provider, provider), eq(pgSchema.modelMappings.inboundModel, model)));
}

async function modelMappingCandidateAsync(provider: Provider, models: string[]) {
  for (const model of models) {
    const mappings = await modelMappingsAsync(provider, model);
    if (mappings.length) return { mappings, matchedModel: model };
  }
  return { mappings: [] as MappingCandidate[], matchedModel: "" };
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
  const { mappings, matchedModel: mappingMatchedModel } = await modelMappingCandidateAsync(req.type, modelCandidates);
  const primaryMapping = mappings[0] ?? null;
  const { catalog } = await modelConfigCandidateAsync(req.type, modelCandidates);
  if (catalog && !catalog.enabled) {
    await recordFailure({ requestId, ts: t0, type: req.type, status: 403, error: "模型已停用", body: req.body, requestHeaders: req.incomingHeaders, model, inboundModel: model, upstreamModel: primaryMapping?.upstreamModel || model, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key });
    releaseAllKeySlots();
    return { kind: "client_error", requestId, status: 403, error: "模型已停用" };
  }

  const routes: RouteCandidate[] = [];
  if (mappings.length) {
    const seen = new Set<string>();
    for (const mapping of mappings) {
      const targetProvider = (mapping.targetProvider ?? mapping.provider) as Provider;
      const upstreamModel = appendModelVariant(model, mappingMatchedModel, mapping.upstreamModel);
      const upstreamModelCandidates = modelLookupCandidates(upstreamModel);
      const { catalog: upstreamCatalog } = await modelConfigCandidateAsync(targetProvider, upstreamModelCandidates);
      if (upstreamCatalog && !upstreamCatalog.enabled) continue;
      const channels = applyMappedChannelScope(await selectChannelsAsync(targetProvider, upstreamModelCandidates), mapping.channelIds);
      for (const channel of channels) {
        const key = `${channel.id}:${mapping.id}:${targetProvider}:${upstreamModel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ channel, targetProvider, upstreamModel, mapping, mappedChannelIds: mapping.channelIds ?? [] });
      }
    }
  } else {
    const channels = await selectChannelsAsync(req.type, modelCandidates);
    routes.push(...channels.map(channel => ({ channel, targetProvider: req.type, upstreamModel: model, mapping: null, mappedChannelIds: [] })));
  }

  async function routeBody(route: RouteCandidate) {
    const converted = JSON.stringify(convertRequestBody({ sourceType: req.type, targetType: route.targetProvider, body: parsed, model: route.upstreamModel, stream: req.stream }));
    return req.stream && route.targetProvider === "openai" && req.openAiEndpoint !== "responses" ? withOpenAiStreamUsage(converted) : converted;
  }

  async function tryFallbackOnce(reason: "no_regular_channel" | "regular_attempts_failed", previousAttempts: { channel: string; error: string; status: number }[] = []): Promise<ProxyResult | null> {
    if (!settings.fallbackEnabled || !settings.fallbackChannelId || !settings.fallbackModel) return null;
    const fallbackChannel = await channelByIdAsync(settings.fallbackChannelId);
    if (!fallbackChannel?.enabled) return null;

    let fallbackBody: string;
    try {
      fallbackBody = JSON.stringify(convertRequestBody({ sourceType: req.type, targetType: fallbackChannel.type, body: parsed, model: settings.fallbackModel, stream: req.stream }));
      if (req.stream && fallbackChannel.type === "openai" && req.openAiEndpoint !== "responses") fallbackBody = withOpenAiStreamUsage(fallbackBody);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      const attempts = [...previousAttempts, { channel: fallbackChannel.name, error, status: 0 }];
      await recordFailure({ requestId, ts: t0, type: req.type, status: 502, error, body: req.body, requestHeaders: req.incomingHeaders, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key, channel: fallbackChannel, attempts });
      releaseAllKeySlots();
      return { kind: "upstream_error", requestId, status: 502, error: USER_UPSTREAM_ERROR, attempts };
    }

    const releaseSlot = await acquireChannelSlot(fallbackChannel.id, fallbackChannel.maxConcurrency ?? 0);
    const attemptStart = Date.now();
    const result = await callUpstream({
      channelType: fallbackChannel.type,
      openAiEndpoint: fallbackChannel.type === "openai" ? req.openAiEndpoint : undefined,
      baseUrl: fallbackChannel.baseUrl,
      upstreamKey: fallbackChannel.apiKey,
      model: settings.fallbackModel,
      body: fallbackBody,
      stream: req.stream,
      signal: req.signal,
      timeoutMs: MAX_LATENCY_MS,
    });

    if (result.ok) {
      await recordChannelObservation(fallbackChannel, { ok: true, latencyMs: Date.now() - attemptStart });
      if (req.stream) {
        const logged = await pipeStreamResponse(result, {
          key, channel: fallbackChannel, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id ?? "", mappedChannelIds: primaryMapping?.channelIds ?? [], t0, type: req.type, targetType: fallbackChannel.type, requestId, body: req.body, requestHeaders: req.incomingHeaders, fallbackReason: reason, releaseSlot: () => { releaseSlot(); releaseAllKeySlots(); },
        });
        return { kind: "success", requestId, response: logged.response, logged: { ...logged.info, channelId: fallbackChannel.id, channelName: fallbackChannel.name } };
      }
      const logged = await collectResponse(result, {
        key, channel: fallbackChannel, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id ?? "", mappedChannelIds: primaryMapping?.channelIds ?? [], t0, type: req.type, targetType: fallbackChannel.type, requestId, body: req.body, requestHeaders: req.incomingHeaders, fallbackReason: reason,
      }).finally(() => { releaseSlot(); releaseAllKeySlots(); });
      return { kind: "success", requestId, response: logged.response, logged: { ...logged.info, channelId: fallbackChannel.id, channelName: fallbackChannel.name } };
    }

    releaseSlot();
    await recordChannelObservation(fallbackChannel, { ok: false, latencyMs: Date.now() - attemptStart, error: result.errorMsg }, { failureStatus: result.status === 429 ? "warn" : "err" });
    const fallbackStatus = result.status > 0 ? result.status : 502;
    const attempts = [...previousAttempts, { channel: fallbackChannel.name, error: result.errorMsg, status: result.status }];
    await recordFailure({ requestId, ts: t0, type: req.type, status: fallbackStatus, error: `fallback ${fallbackChannel.name}: ${result.errorMsg}`, body: req.body, requestHeaders: req.incomingHeaders, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key, channel: fallbackChannel, attempts });
    releaseAllKeySlots();
    return { kind: "upstream_error", requestId, status: fallbackStatus, error: USER_UPSTREAM_ERROR, attempts };
  }

  // 3) 选渠道
  if (routes.length === 0) {
    const fallbackResult = await tryFallbackOnce("no_regular_channel");
    if (fallbackResult) return fallbackResult;
    const status = mappings.length ? 503 : 404;
    const error = mappings.length ? NO_LIVE_CHANNEL_ERROR : upstreamModelError(model);
    await recordFailure({ requestId, ts: t0, type: req.type, status, error, body: req.body, requestHeaders: req.incomingHeaders, model, inboundModel: model, upstreamModel: primaryMapping?.upstreamModel ?? model, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key });
    releaseAllKeySlots();
    if (mappings.length) return { kind: "upstream_error", requestId, status, error, attempts: [] };
    return { kind: "client_error", requestId, status: 404, error };
  }

  // 4) 转发（带重试）
  const attempts: { channel: string; error: string; status: number }[] = [];
  const tried = new Set<string>();
  const attemptCounts = new Map<string, number>();
  let retryRoute: RouteCandidate | null = null;
  let lastError = "";
  let lastStatus = 0;
  let lastRoute: RouteCandidate | undefined;

  for (let i = 0; i < settings.proxyMaxRetries; i++) {
    const freshPool = routes.filter(route => !tried.has(routeKey(route)));
    const pool = retryRoute ? [retryRoute] : freshPool.length ? freshPool : routes;
    const saturation = await Promise.all(pool.map(async route => [routeKey(route), await isChannelSaturated(route.channel.id, route.channel.maxConcurrency ?? 0)] as const));
    const saturatedKeys = new Set(saturation.filter(([, saturated]) => saturated).map(([key]) => key));
    const availablePool = pool.filter(route => !saturatedKeys.has(routeKey(route)));
    const route = pickRoutePriorityRandom(availablePool.length ? availablePool : pool);
    if (!route) break;
    retryRoute = null;
    lastRoute = route;

    let upstreamBody: string;
    try {
      upstreamBody = await routeBody(route);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      attempts.push({ channel: route.channel.name, error, status: 0 });
      lastError = `${route.channel.name}: ${error}`;
      lastStatus = 0;
      tried.add(routeKey(route));
      continue;
    }

    const releaseSlot = await acquireChannelSlot(route.channel.id, route.channel.maxConcurrency ?? 0);
    const attemptStart = Date.now();
    const result = await callUpstream({
      channelType: route.targetProvider,
      openAiEndpoint: route.targetProvider === "openai" ? req.openAiEndpoint : undefined,
      baseUrl: route.channel.baseUrl,
      upstreamKey: route.channel.apiKey,
      model: route.upstreamModel,
      body: upstreamBody,
      stream: req.stream,
      signal: req.signal,
      timeoutMs: MAX_LATENCY_MS,
    });

    if (result.ok) {
      await recordChannelObservation(route.channel, { ok: true, latencyMs: Date.now() - attemptStart });
      if (req.stream) {
        const logged = await pipeStreamResponse(result, {
          key, channel: route.channel, model: route.upstreamModel, inboundModel: model, upstreamModel: route.upstreamModel, mappingId: route.mapping?.id ?? "", mappedChannelIds: route.mappedChannelIds, t0, type: req.type, targetType: route.targetProvider, requestId, body: req.body, requestHeaders: req.incomingHeaders, releaseSlot: () => { releaseSlot(); releaseAllKeySlots(); },
        });
        return { kind: "success", requestId, response: logged.response, logged: { ...logged.info, channelId: route.channel.id, channelName: route.channel.name } };
      }
      const logged = await collectResponse(result, {
        key, channel: route.channel, model: route.upstreamModel, inboundModel: model, upstreamModel: route.upstreamModel, mappingId: route.mapping?.id ?? "", mappedChannelIds: route.mappedChannelIds, t0, type: req.type, targetType: route.targetProvider, requestId, body: req.body, requestHeaders: req.incomingHeaders,
      }).finally(() => { releaseSlot(); releaseAllKeySlots(); });
      return { kind: "success", requestId, response: logged.response, logged: { ...logged.info, channelId: route.channel.id, channelName: route.channel.name } };
    }

    releaseSlot();
    const observed = await recordChannelObservation(route.channel, {
      ok: false,
      latencyMs: Date.now() - attemptStart,
      error: result.errorMsg,
    }, { failureStatus: result.status === 429 ? "warn" : "err" });
    route.channel.status = observed.status;

    attempts.push({ channel: route.channel.name, error: result.errorMsg, status: result.status });
    lastError = `${route.channel.name}: ${result.errorMsg}`;
    lastStatus = result.status;
    const keyForRoute = routeKey(route);
    const count = (attemptCounts.get(keyForRoute) ?? 0) + 1;
    attemptCounts.set(keyForRoute, count);
    if (count < 2 && i + 1 < settings.proxyMaxRetries) {
      retryRoute = route;
    } else {
      tried.add(keyForRoute);
    }
  }

  // 全部失败
  const fallbackResult = await tryFallbackOnce("regular_attempts_failed", attempts);
  if (fallbackResult) return fallbackResult;
  const finalStatus = lastStatus > 0 ? lastStatus : 502;
  const finalModel = lastRoute?.upstreamModel ?? primaryMapping?.upstreamModel ?? model;
  const internalError = lastError
    ? unsupportedModelMessage(lastStatus, lastError, finalModel)
    : NO_LIVE_CHANNEL_ERROR;
  await recordFailure({ requestId, ts: t0, type: req.type, status: finalStatus, error: internalError, body: req.body, requestHeaders: req.incomingHeaders, model: finalModel, inboundModel: model, upstreamModel: finalModel, mappingId: lastRoute?.mapping?.id ?? primaryMapping?.id, mappedChannelIds: lastRoute?.mappedChannelIds ?? primaryMapping?.channelIds ?? [], key, channel: lastRoute?.channel, attempts });
  releaseAllKeySlots();
  return {
    kind: "upstream_error",
    requestId,
    status: finalStatus,
    error: USER_UPSTREAM_ERROR,
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
  fallbackReason?: string;
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
    requestDetail: await requestDetail({ requestId: ctx.requestId, type: ctx.type, status: upstreamStatus, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders, requestBody: ctx.body, fallbackReason: ctx.fallbackReason }),
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
      requestDetail: await requestDetail({ requestId: ctx.requestId, type: ctx.type, status, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders, requestBody: ctx.body, responseBody: detailBuffer, tokensIn, tokensOut, cacheReadTokens, cacheCreationTokens, fallbackReason: ctx.fallbackReason }),
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
            requestDetail: await requestDetail({ requestId: ctx.requestId, type: ctx.type, status: upstreamStatus, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders, requestBody: ctx.body, tokensIn, tokensOut, cacheReadTokens, cacheCreationTokens, fallbackReason: ctx.fallbackReason }),
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

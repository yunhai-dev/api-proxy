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
import { circuitAllows, recordChannelObservation } from "./channel-health";
import { effectiveUserLimits, effectiveUserLimitsAsync } from "./user-quota";
import { checkTpm, consumeRpm, reserveTpm, settleTpmReservation, type TpmReservation } from "./rate-limit";
import { usePostgres } from "./db/runtime";
import { appendModelVariant, modelLookupCandidates } from "./model-variants";
import { convertRequestBody, convertResponseBody, createSseResponseConverter } from "./protocol-conversion";
import { requiredCapabilities, routeSupportsCapabilities } from "./protocol-capabilities";
import { withOpenAiSerialTools } from "./openai-responses-lite";

const MAX_LATENCY_MS = 60_000;
const NO_LIVE_CHANNEL_ERROR = "没有存活的渠道";
const USER_UPSTREAM_ERROR = "平台暂时无法处理请求，请稍后重试";
const ZERO_OUTPUT_TOKEN_ERROR = "上游返回 200 但输出 Token 为 0";

function shouldRetryUpstream(status: number, settings: Awaited<ReturnType<typeof getSettingsAsync>>) {
  if (status === 0) return settings.proxyRetryNetwork;
  if (status === 404) return true;
  if (status === 429) return settings.proxyRetry429;
  return status >= 500 && settings.proxyRetry5xx;
}

export type ResolveKey =
  | { ok: true; key: typeof schema.keys.$inferSelect }
  | { ok: false; status: 401 | 402 | 403 | 429; error: string; key?: typeof schema.keys.$inferSelect };

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
  if (key.status === "disabled") return { ok: false, status: 403, error: "密钥已停用", key };
  if (key.quota > 0 && key.used >= key.quota) {
    return { ok: false, status: 429, error: "已超出当日配额", key };
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

async function effectiveUserTpmLimit(userId: string) {
  if (!userId) return 0;
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("./db/pg");
    const quota = (await pgDb.select().from(pgSchema.userQuotas).where(eq(pgSchema.userQuotas.userId, userId)).limit(1))[0] as typeof schema.userQuotas.$inferSelect | undefined;
    return (await effectiveUserLimitsAsync(quota)).rateLimitTpm;
  }
  return effectiveUserLimits(db.select().from(schema.userQuotas).where(eq(schema.userQuotas.userId, userId)).get()).rateLimitTpm;
}

function numericField(body: Record<string, unknown>, name: string) {
  const value = body[name];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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
  const available = matched.filter(c => circuitAllows(c));
  const healthy = available.filter(c => c.status !== "err");
  return healthy.length ? healthy : available;
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
  const available = matched.filter(c => circuitAllows(c));
  const healthy = available.filter(c => c.status !== "err");
  return healthy.length ? healthy : available;
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
  capabilityProfile: string[];
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

export function selectedCapabilityProfile(channelCapabilities: string[] = [], modelCapabilities: string[] = []) {
  return [...new Set([...channelCapabilities, ...modelCapabilities])];
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
  openAiEndpoint?: "chat_completions" | "responses" | "embeddings";
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

export function proxyErrorSource(result: Exclude<ProxyResult, { kind: "success" }>) {
  return result.kind === "upstream_error" && result.attempts.length ? "upstream" : "proxy";
}

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

function redactBody(value: string) {
  try {
    return JSON.stringify(redactValue(JSON.parse(value)));
  } catch {
    return truncateLogText(value);
  }
}

function reasoningDetail(value: string) {
  try {
    const body = JSON.parse(value) as Record<string, unknown>;
    const reasoning = body.reasoning && typeof body.reasoning === "object" && !Array.isArray(body.reasoning) ? body.reasoning as Record<string, unknown> : null;
    const outputConfig = body.output_config && typeof body.output_config === "object" && !Array.isArray(body.output_config) ? body.output_config as Record<string, unknown> : null;
    const effort = typeof body.reasoning_effort === "string" ? body.reasoning_effort
      : typeof reasoning?.effort === "string" ? reasoning.effort
        : typeof outputConfig?.effort === "string" ? outputConfig.effort
          : null;
    return effort ? { effort } : null;
  } catch {
    return null;
  }
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [
    key,
    key === "arguments" || key === "input" || key === "output" || key === "data"
      ? "[redacted]"
      : redactValue(child),
  ]));
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
    body: redactBody(input.body),
  });
}

export function protocolDirection(
  sourceType: Provider,
  targetType?: Provider,
) {
  if (!targetType) return null;
  return sourceType === targetType ? "native" : `${sourceType}_to_${targetType}`;
}

export function upstreamRequestId(headers: Headers) {
  for (const name of ["x-request-id", "request-id", "anthropic-request-id"]) {
    const value = headers.get(name)?.trim();
    if (value) return value.slice(0, 256);
  }
  return null;
}

async function requestDetail(input: {
  requestId: string;
  type: Provider;
  targetType?: Provider;
  openAiEndpoint?: ProxyRequest["openAiEndpoint"];
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
  attempts?: { channel: string; error: string; status: number }[];
  upstreamRequestId?: string | null;
  requiredCapabilities?: string[];
  capabilityProfile?: string[];
  compatibilityRejection?: string;
}) {
  const settings = await getSettingsAsync();
  const auditBridge = settings.bridgeCapabilityAudit && input.targetType && input.type !== input.targetType;
  const reasoning = reasoningDetail(input.requestBody);
  if (!settings.recordAllRequestDetails && !auditBridge && !reasoning) return null;
  return JSON.stringify({
    request_id: input.requestId,
    type: input.type,
    protocol: input.targetType
      ? { direction: protocolDirection(input.type, input.targetType), endpoint: input.openAiEndpoint ?? null }
      : null,
    status: input.status,
    inbound_model: input.inboundModel,
    upstream_model: input.upstreamModel,
    channel: input.channelName ?? null,
    upstream_request_id: input.upstreamRequestId ?? null,
    reasoning: reasoningDetail(input.requestBody),
    capabilities: input.targetType && input.type !== input.targetType
      ? { required: input.requiredCapabilities ?? [], selected: input.capabilityProfile ?? [] }
      : null,
    compatibility_rejection: input.compatibilityRejection ?? null,
    fallback: input.fallbackReason ? { reason: input.fallbackReason } : null,
    attempts: input.attempts ?? [],
    request_headers: settings.recordAllRequestDetails ? sanitizeHeaders(input.requestHeaders) : null,
    request_body: settings.recordAllRequestDetails ? redactBody(input.requestBody) : null,
    response_body: settings.recordAllRequestDetails && input.responseBody != null ? redactBody(input.responseBody) : null,
    tokens: settings.recordAllRequestDetails ? {
      input: input.tokensIn ?? 0,
      output: input.tokensOut ?? 0,
      cache_read: input.cacheReadTokens ?? 0,
      cache_creation: input.cacheCreationTokens ?? 0,
    } : null,
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
  targetType?: Provider;
  status: number;
  error: string;
  body: string;
  requestHeaders?: Headers;
  model?: string;
  inboundModel?: string;
  upstreamModel?: string;
  mappingId?: string;
  mappedChannelIds?: string[];
  compatibilityRejection?: string;
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
    requestDetail: await requestDetail({ requestId: input.requestId, type: input.type, targetType: input.targetType, status: input.status, inboundModel: input.inboundModel || input.model || "—", upstreamModel: input.upstreamModel || input.model || "—", channelName: input.channel?.name, requestHeaders: input.requestHeaders, requestBody: input.body, attempts: input.attempts, compatibilityRejection: input.compatibilityRejection }),
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
    .where(and(eq(schema.modelMappings.provider, provider), eq(schema.modelMappings.inboundModel, model), eq(schema.modelMappings.enabled, true)))
    .all() as MappingCandidate[];
}

async function modelMappingsAsync(provider: Provider, model: string): Promise<MappingCandidate[]> {
  if (!usePostgres()) return modelMappings(provider, model);
  const { pgDb, pgSchema } = await import("./db/pg");
  return await pgDb
    .select()
    .from(pgSchema.modelMappings)
    .where(and(eq(pgSchema.modelMappings.provider, provider), eq(pgSchema.modelMappings.inboundModel, model), eq(pgSchema.modelMappings.enabled, true)));
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
    await recordFailure({ requestId, ts: t0, type: req.type, status: 429, error: message, body: req.body, requestHeaders: req.incomingHeaders, model: extractModel(req.body) ?? undefined });
    return { kind: "client_error", requestId, status: 429, error: message };
  }

  // 1) 解析 key
  const resolved = await resolveApiKeyAsync(req.rawAuth);
  if (!resolved.ok) {
    if (resolved.status !== 401) {
      await recordFailure({ requestId, ts: t0, type: req.type, status: resolved.status, error: resolved.error, body: req.body, requestHeaders: req.incomingHeaders, model: extractModel(req.body) ?? undefined, key: resolved.key });
    }
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
  let releaseUserSlot = () => {};
  let releaseKeySlot = () => {};
  try {
    releaseUserSlot = await acquireKeySlot(`user:${key.userId}`, await userMaxConcurrency(key.userId), req.signal);
    releaseKeySlot = await acquireKeySlot(key.id, key.maxConcurrency ?? 0, req.signal);
  } catch (e: unknown) {
    releaseUserSlot();
    const error = e instanceof Error ? e.message : String(e);
    await recordFailure({ requestId, ts: t0, type: req.type, status: 429, error, body: req.body, requestHeaders: req.incomingHeaders, key });
    return { kind: "client_error", requestId, status: 429, error: "请求已取消或并发队列等待失败" };
  }
  const releaseAllKeySlots = () => { releaseKeySlot(); releaseUserSlot(); };
  let tpmReservation: TpmReservation | null = null;
  let tpmSettled = false;
  const settleTpm = async (actualTokens: number | null) => {
    if (!tpmReservation || tpmSettled) return;
    tpmSettled = true;
    await settleTpmReservation(tpmReservation, actualTokens).catch(() => null);
  };

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

  const openAiOnly = req.openAiEndpoint === "embeddings";
  const routeCapabilities = (targetType: Provider) => requiredCapabilities({
    sourceType: req.type,
    targetType,
    openAiEndpoint: req.openAiEndpoint,
    body: parsed,
    stream: req.stream,
  });
  const supportsRequest = (
    channel: ChannelCandidate,
    targetType: Provider,
    catalog: { capabilities: string[] } | null,
  ) => routeSupportsCapabilities({
    channelCapabilities: channel.capabilities ?? [],
    modelCapabilities: catalog?.capabilities ?? [],
    sourceType: req.type,
    targetType,
    required: routeCapabilities(targetType),
  });
  const routes: RouteCandidate[] = [];
  if (mappings.length) {
    const seen = new Set<string>();
    for (const mapping of mappings) {
      const targetProvider = (mapping.targetProvider ?? mapping.provider) as Provider;
      if (openAiOnly && targetProvider !== "openai") continue;
      const upstreamModel = appendModelVariant(model, mappingMatchedModel, mapping.upstreamModel);
      const upstreamModelCandidates = modelLookupCandidates(upstreamModel);
      const { catalog: upstreamCatalog } = await modelConfigCandidateAsync(targetProvider, upstreamModelCandidates);
      if (upstreamCatalog && !upstreamCatalog.enabled) continue;
      const channels = applyMappedChannelScope(
        applyMappedChannelScope(await selectChannelsAsync(targetProvider, upstreamModelCandidates), mapping.channelIds),
        key.channelId ? [key.channelId] : undefined,
      );
      for (const channel of channels) {
        if (!supportsRequest(channel, targetProvider, upstreamCatalog)) continue;
        const key = `${channel.id}:${mapping.id}:${targetProvider}:${upstreamModel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push({ channel, targetProvider, upstreamModel, mapping, mappedChannelIds: mapping.channelIds ?? [], capabilityProfile: selectedCapabilityProfile(channel.capabilities, upstreamCatalog?.capabilities) });
      }
    }
  } else {
    const targetProvider = openAiOnly ? "openai" : req.type;
    const { catalog: upstreamCatalog } = await modelConfigCandidateAsync(targetProvider, modelCandidates);
    const channels = applyMappedChannelScope(await selectChannelsAsync(targetProvider, modelCandidates), key.channelId ? [key.channelId] : undefined);
    routes.push(...channels
      .filter(channel => supportsRequest(channel, targetProvider, upstreamCatalog))
      .map(channel => ({ channel, targetProvider, upstreamModel: model, mapping: null, mappedChannelIds: [], capabilityProfile: selectedCapabilityProfile(channel.capabilities, upstreamCatalog?.capabilities) })));
  }

  async function routeBody(route: RouteCandidate) {
    const body = withOpenAiSerialTools(parsed, {
      type: route.targetProvider,
      openAiEndpoint: req.openAiEndpoint,
      model: route.upstreamModel,
    });
    const converted = JSON.stringify(convertRequestBody({ sourceType: req.type, targetType: route.targetProvider, openAiEndpoint: req.openAiEndpoint, body, model: route.upstreamModel, stream: req.stream }));
    return req.stream && route.targetProvider === "openai" && req.openAiEndpoint !== "responses" ? withOpenAiStreamUsage(converted) : converted;
  }

  async function tryFallbackOnce(reason: "no_regular_channel" | "regular_attempts_failed", previousAttempts: { channel: string; error: string; status: number }[] = []): Promise<ProxyResult | null> {
    if (!settings.fallbackEnabled || !settings.fallbackChannelId || !settings.fallbackModel) return null;
    const fallbackChannel = await channelByIdAsync(settings.fallbackChannelId);
    if (!fallbackChannel?.enabled || (openAiOnly && fallbackChannel.type !== "openai")) return null;
    const { catalog: fallbackCatalog } = await modelConfigCandidateAsync(
      fallbackChannel.type,
      modelLookupCandidates(settings.fallbackModel),
    );

    let fallbackBody: string;
    try {
      const body = withOpenAiSerialTools(parsed, {
        type: fallbackChannel.type,
        openAiEndpoint: req.openAiEndpoint,
        model: settings.fallbackModel,
      });
      fallbackBody = JSON.stringify(convertRequestBody({ sourceType: req.type, targetType: fallbackChannel.type, openAiEndpoint: req.openAiEndpoint, body, model: settings.fallbackModel, stream: req.stream }));
      if (req.stream && fallbackChannel.type === "openai" && req.openAiEndpoint !== "responses") fallbackBody = withOpenAiStreamUsage(fallbackBody);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      await recordFailure({ requestId, ts: t0, type: req.type, status: 400, error, body: req.body, requestHeaders: req.incomingHeaders, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], targetType: fallbackChannel.type, compatibilityRejection: req.type !== fallbackChannel.type ? error : undefined, key, channel: fallbackChannel });
      await settleTpm(0);
      releaseAllKeySlots();
      return { kind: "client_error", requestId, status: 400, error };
    }

    let releaseSlot: () => void;
    try {
      releaseSlot = await acquireChannelSlot(fallbackChannel.id, fallbackChannel.maxConcurrency ?? 0, req.signal);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      await recordFailure({ requestId, ts: t0, type: req.type, status: 429, error, body: req.body, requestHeaders: req.incomingHeaders, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key, channel: fallbackChannel });
      await settleTpm(0);
      releaseAllKeySlots();
      return { kind: "client_error", requestId, status: 429, error: "请求已取消或并发队列等待失败" };
    }
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
      incomingHeaders: req.incomingHeaders,
      timeoutMs: MAX_LATENCY_MS,
    });

    if (result.ok) {
      if (req.stream) {
        const canRetryEmpty = settings.proxyTreatEmptyOutputAsFailure && settings.proxyRetryNetwork;
        const prepared: ResponseProcessResult = await prepareStreamResponse(result, {
          key, channel: fallbackChannel, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id ?? "", mappedChannelIds: primaryMapping?.channelIds ?? [], t0, type: req.type, targetType: fallbackChannel.type, openAiEndpoint: req.openAiEndpoint, requestId, body: req.body, requestHeaders: req.incomingHeaders, fallbackReason: reason, attempts: previousAttempts, upstreamRequestId: upstreamRequestId(result.headers), requiredCapabilities: routeCapabilities(fallbackChannel.type), capabilityProfile: selectedCapabilityProfile(fallbackChannel.capabilities, fallbackCatalog?.capabilities), settleTpm, releaseSlot: () => { releaseSlot(); releaseAllKeySlots(); },
        }, canRetryEmpty);

        if (!prepared.ok && prepared.reason === "empty") {
          releaseSlot();
          releaseAllKeySlots();
          await recordChannelObservation(fallbackChannel, { ok: false, latencyMs: Date.now() - attemptStart, error: prepared.message }, { failureStatus: "warn" });
          const attempts = [...previousAttempts, { channel: fallbackChannel.name, error: prepared.message, status: result.status }];
          await recordFailure({ requestId, ts: t0, type: req.type, status: 502, error: `fallback ${fallbackChannel.name}: ${prepared.message}`, body: req.body, requestHeaders: req.incomingHeaders, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key, channel: fallbackChannel, attempts });
          await settleTpm(null);
          return { kind: "upstream_error", requestId, status: 502, error: USER_UPSTREAM_ERROR, attempts };
        }
        if (!prepared.ok) {
          releaseSlot();
          releaseAllKeySlots();
          const attempts = [...previousAttempts, { channel: fallbackChannel.name, error: prepared.message, status: result.status }];
          await recordFailure({ requestId, ts: t0, type: req.type, status: 502, error: `fallback ${fallbackChannel.name}: ${prepared.message}`, body: req.body, requestHeaders: req.incomingHeaders, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key, channel: fallbackChannel, attempts });
          await settleTpm(null);
          return { kind: "upstream_error", requestId, status: 502, error: USER_UPSTREAM_ERROR, attempts };
        }
        await recordChannelObservation(fallbackChannel, { ok: true, latencyMs: Date.now() - attemptStart });
        return { kind: "success", requestId, response: prepared.response, logged: { ...prepared.info, channelId: fallbackChannel.id, channelName: fallbackChannel.name } };
      }
      const canRetryEmpty = settings.proxyTreatEmptyOutputAsFailure && settings.proxyRetryNetwork;
      let processed: ResponseProcessResult;
      try {
        processed = await collectResponse(result, {
          key, channel: fallbackChannel, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id ?? "", mappedChannelIds: primaryMapping?.channelIds ?? [], t0, type: req.type, targetType: fallbackChannel.type, openAiEndpoint: req.openAiEndpoint, requestId, body: req.body, requestHeaders: req.incomingHeaders, fallbackReason: reason, attempts: previousAttempts, upstreamRequestId: upstreamRequestId(result.headers), requiredCapabilities: routeCapabilities(fallbackChannel.type), capabilityProfile: selectedCapabilityProfile(fallbackChannel.capabilities, fallbackCatalog?.capabilities), settleTpm,
        }, canRetryEmpty);
      } catch (e: unknown) {
        const error = e instanceof Error ? e.message : String(e);
        await settleTpm(null);
        const attempts = [...previousAttempts, { channel: fallbackChannel.name, error, status: 502 }];
        await recordChannelObservation(fallbackChannel, { ok: false, latencyMs: Date.now() - attemptStart, error }, { failureStatus: "err" });
        await recordFailure({ requestId, ts: t0, type: req.type, status: 502, error, body: req.body, requestHeaders: req.incomingHeaders, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key, channel: fallbackChannel, attempts });
        return { kind: "upstream_error", requestId, status: 502, error: USER_UPSTREAM_ERROR, attempts };
      } finally {
        releaseSlot();
        releaseAllKeySlots();
      }

      if (!processed.ok && processed.reason === "empty") {
        await recordChannelObservation(fallbackChannel, { ok: false, latencyMs: Date.now() - attemptStart, error: processed.message }, { failureStatus: "warn" });
        const attempts = [...previousAttempts, { channel: fallbackChannel.name, error: processed.message, status: result.status }];
        await recordFailure({ requestId, ts: t0, type: req.type, status: 502, error: `fallback ${fallbackChannel.name}: ${processed.message}`, body: req.body, requestHeaders: req.incomingHeaders, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key, channel: fallbackChannel, attempts });
        return { kind: "upstream_error", requestId, status: 502, error: USER_UPSTREAM_ERROR, attempts };
      }

      const response = processed.ok ? processed.response : new Response(processed.info.responseBody ?? "", {
        status: processed.info.status,
        headers: (() => {
          const h = new Headers();
          h.set("content-type", processed.info.responseContentType ?? "application/json");
          h.set("x-proxy-channel-id", fallbackChannel.id);
          h.set("x-proxy-model", fallbackChannel.name);
          h.set("x-request-id", requestId);
          return h;
        })(),
      });
      const errorMsg = processed.ok ? null : (processed.message ?? null);
      await recordChannelObservation(fallbackChannel, { ok: processed.ok, latencyMs: Date.now() - attemptStart, error: errorMsg ?? undefined }, { failureStatus: processed.ok ? undefined : "warn" });
      await recordSuccessOrAcceptedEmpty(
        { key, channel: fallbackChannel, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id ?? "", mappedChannelIds: primaryMapping?.channelIds ?? [], t0, type: req.type, targetType: fallbackChannel.type, openAiEndpoint: req.openAiEndpoint, requestId, body: req.body, requestHeaders: req.incomingHeaders, fallbackReason: reason, attempts: previousAttempts, upstreamRequestId: upstreamRequestId(result.headers), requiredCapabilities: routeCapabilities(fallbackChannel.type), capabilityProfile: selectedCapabilityProfile(fallbackChannel.capabilities, fallbackCatalog?.capabilities), settleTpm },
        processed.info,
        errorMsg,
      );
      await settleTpm(processed.info.tokensIn + processed.info.tokensOut);
      return { kind: "success", requestId, response, logged: { ...processed.info, channelId: fallbackChannel.id, channelName: fallbackChannel.name } };
    }

    releaseSlot();
    await recordChannelObservation(fallbackChannel, { ok: false, latencyMs: Date.now() - attemptStart, error: result.errorMsg }, { failureStatus: result.status === 429 ? "warn" : "err" });
    const fallbackStatus = result.status > 0 ? result.status : 502;
    const attempts = [...previousAttempts, { channel: fallbackChannel.name, error: result.errorMsg, status: result.status }];
    await recordFailure({ requestId, ts: t0, type: req.type, status: fallbackStatus, error: `fallback ${fallbackChannel.name}: ${result.errorMsg}`, body: req.body, requestHeaders: req.incomingHeaders, model: settings.fallbackModel, inboundModel: model, upstreamModel: settings.fallbackModel, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key, channel: fallbackChannel, attempts });
    await settleTpm(0);
    releaseAllKeySlots();
    return { kind: "upstream_error", requestId, status: fallbackStatus, error: USER_UPSTREAM_ERROR, attempts };
  }

  const requestedOutputTokens = numericField(parsed, req.type === "claude" ? "max_tokens" : req.openAiEndpoint === "responses" ? "max_output_tokens" : "max_completion_tokens")
    ?? numericField(parsed, "max_tokens")
    ?? 0;
  const userTpmLimit = await effectiveUserTpmLimit(key.userId);
  const configuredTpmLimits = [key.rateLimitTpm, userTpmLimit].filter(limit => limit > 0);
  const inputTokenUpperBound = new TextEncoder().encode(req.body).byteLength;
  const estimatedTokens = requestedOutputTokens > 0
    ? inputTokenUpperBound + requestedOutputTokens
    : Math.min(...configuredTpmLimits);
  const reservation = await reserveTpm({
    requestId,
    keyId: key.id,
    keyLimit: key.rateLimitTpm,
    userId: key.userId,
    userLimit: userTpmLimit,
    tokens: estimatedTokens,
  });
  if (reservation === false) {
    await recordFailure({ requestId, ts: t0, type: req.type, status: 429, error: "已超出每分钟 Token 限制", body: req.body, requestHeaders: req.incomingHeaders, model, key });
    releaseAllKeySlots();
    return { kind: "client_error", requestId, status: 429, error: "已超出每分钟 Token 限制" };
  }
  tpmReservation = reservation;

  // 3) 选渠道
  if (routes.length === 0) {
    const fallbackResult = await tryFallbackOnce("no_regular_channel");
    if (fallbackResult) return fallbackResult;
    const fallbackConfigured = settings.fallbackEnabled && settings.fallbackChannelId && settings.fallbackModel;
    const status = mappings.length || fallbackConfigured ? 503 : 404;
    const error = mappings.length || fallbackConfigured ? NO_LIVE_CHANNEL_ERROR : upstreamModelError(model);
    await recordFailure({ requestId, ts: t0, type: req.type, status, error, body: req.body, requestHeaders: req.incomingHeaders, model, inboundModel: model, upstreamModel: primaryMapping?.upstreamModel ?? model, mappingId: primaryMapping?.id, mappedChannelIds: primaryMapping?.channelIds ?? [], key });
    await settleTpm(0);
    releaseAllKeySlots();
    if (mappings.length || fallbackConfigured) return { kind: "upstream_error", requestId, status, error, attempts: [] };
    return { kind: "client_error", requestId, status: 404, error };
  }

  // 4) 转发（带重试）
  const attempts: { channel: string; error: string; status: number }[] = [];
  const tried = new Set<string>();
  let lastError = "";
  let lastStatus = 0;
  let lastRoute: RouteCandidate | undefined;

  const maxRegularAttempts = Math.min(routes.length, settings.proxyMaxRetries + 1);
  for (let i = 0; i < maxRegularAttempts; i++) {
    const pool = routes.filter(route => !tried.has(routeKey(route)));
    if (!pool.length) break;
    const saturation = await Promise.all(pool.map(async route => [routeKey(route), await isChannelSaturated(route.channel.id, route.channel.maxConcurrency ?? 0)] as const));
    const saturatedKeys = new Set(saturation.filter(([, saturated]) => saturated).map(([key]) => key));
    const availablePool = pool.filter(route => !saturatedKeys.has(routeKey(route)));
    const route = pickRoutePriorityRandom(availablePool.length ? availablePool : pool);
    if (!route) break;
    lastRoute = route;

    let upstreamBody: string;
    try {
      upstreamBody = await routeBody(route);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      await recordFailure({ requestId, ts: t0, type: req.type, status: 400, error, body: req.body, requestHeaders: req.incomingHeaders, model, inboundModel: model, upstreamModel: route.upstreamModel, mappingId: route.mapping?.id, mappedChannelIds: route.mappedChannelIds, targetType: route.targetProvider, compatibilityRejection: req.type !== route.targetProvider ? error : undefined, key, channel: route.channel });
      await settleTpm(0);
      releaseAllKeySlots();
      return { kind: "client_error", requestId, status: 400, error };
    }

    let releaseSlot: () => void;
    try {
      releaseSlot = await acquireChannelSlot(route.channel.id, route.channel.maxConcurrency ?? 0, req.signal);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      if (req.signal?.aborted) {
        await recordFailure({ requestId, ts: t0, type: req.type, status: 499, error, body: req.body, requestHeaders: req.incomingHeaders, model, inboundModel: model, upstreamModel: route.upstreamModel, mappingId: route.mapping?.id, mappedChannelIds: route.mappedChannelIds, key, channel: route.channel });
        await settleTpm(0);
        releaseAllKeySlots();
        return { kind: "client_error", requestId, status: 429, error: "请求已取消" };
      }
      attempts.push({ channel: route.channel.name, error, status: 429 });
      lastError = `${route.channel.name}: ${error}`;
      lastStatus = 429;
      tried.add(routeKey(route));
      continue;
    }
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
      incomingHeaders: req.incomingHeaders,
      timeoutMs: MAX_LATENCY_MS,
    });

    if (result.ok) {
      if (req.stream) {
        const canRetryEmpty = settings.proxyTreatEmptyOutputAsFailure && settings.proxyRetryNetwork;
        const prepared: ResponseProcessResult = await prepareStreamResponse(result, {
          key, channel: route.channel, model: route.upstreamModel, inboundModel: model, upstreamModel: route.upstreamModel, mappingId: route.mapping?.id ?? "", mappedChannelIds: route.mappedChannelIds, t0, type: req.type, targetType: route.targetProvider, openAiEndpoint: req.openAiEndpoint, requestId, body: req.body, requestHeaders: req.incomingHeaders, attempts, upstreamRequestId: upstreamRequestId(result.headers), requiredCapabilities: routeCapabilities(route.targetProvider), capabilityProfile: route.capabilityProfile, settleTpm, releaseSlot: () => { releaseSlot(); releaseAllKeySlots(); },
        }, canRetryEmpty);

        if (!prepared.ok) {
          releaseSlot();
          await recordChannelObservation(route.channel, { ok: false, latencyMs: Date.now() - attemptStart, error: prepared.message }, { failureStatus: prepared.reason === "empty" ? "warn" : "err" });
          attempts.push({ channel: route.channel.name, error: prepared.message, status: result.status });
          lastError = `${route.channel.name}: ${prepared.message}`;
          lastStatus = result.status;
          tried.add(routeKey(route));
          continue;
        }

        await recordChannelObservation(route.channel, { ok: true, latencyMs: Date.now() - attemptStart });
        return { kind: "success", requestId, response: prepared.response, logged: { ...prepared.info, channelId: route.channel.id, channelName: route.channel.name } };
      }
      const canRetryEmpty = settings.proxyTreatEmptyOutputAsFailure && settings.proxyRetryNetwork;
      let processed: ResponseProcessResult;
      try {
        processed = await collectResponse(result, {
          key, channel: route.channel, model: route.upstreamModel, inboundModel: model, upstreamModel: route.upstreamModel, mappingId: route.mapping?.id ?? "", mappedChannelIds: route.mappedChannelIds, t0, type: req.type, targetType: route.targetProvider, openAiEndpoint: req.openAiEndpoint, requestId, body: req.body, requestHeaders: req.incomingHeaders, attempts, upstreamRequestId: upstreamRequestId(result.headers), requiredCapabilities: routeCapabilities(route.targetProvider), capabilityProfile: route.capabilityProfile, settleTpm,
        }, canRetryEmpty);
      } catch (e: unknown) {
        const error = e instanceof Error ? e.message : String(e);
        await settleTpm(null);
        await recordChannelObservation(route.channel, { ok: false, latencyMs: Date.now() - attemptStart, error }, { failureStatus: "err" });
        attempts.push({ channel: route.channel.name, error, status: 502 });
        lastError = `${route.channel.name}: ${error}`;
        lastStatus = 502;
        tried.add(routeKey(route));
        continue;
      } finally {
        releaseSlot();
      }

      if (!processed.ok && processed.reason === "empty") {
        await recordChannelObservation(route.channel, { ok: false, latencyMs: Date.now() - attemptStart, error: processed.message }, { failureStatus: "warn" });
        attempts.push({ channel: route.channel.name, error: processed.message, status: result.status });
        lastError = `${route.channel.name}: ${processed.message}`;
        lastStatus = result.status;
        tried.add(routeKey(route));
        continue;
      }

      if (!processed.ok) continue;

      const response = processed.response;
      const errorMsg = null;
      await recordChannelObservation(route.channel, { ok: true, latencyMs: Date.now() - attemptStart });
      await recordSuccessOrAcceptedEmpty(
        { key, channel: route.channel, model: route.upstreamModel, inboundModel: model, upstreamModel: route.upstreamModel, mappingId: route.mapping?.id ?? "", mappedChannelIds: route.mappedChannelIds, t0, type: req.type, targetType: route.targetProvider, openAiEndpoint: req.openAiEndpoint, requestId, body: req.body, requestHeaders: req.incomingHeaders, attempts, upstreamRequestId: upstreamRequestId(result.headers), requiredCapabilities: routeCapabilities(route.targetProvider), capabilityProfile: route.capabilityProfile, settleTpm },
        processed.info,
        errorMsg,
      );
      await settleTpm(processed.info.tokensIn + processed.info.tokensOut);
      releaseAllKeySlots();
      return { kind: "success", requestId, response, logged: { ...processed.info, channelId: route.channel.id, channelName: route.channel.name } };
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
    tried.add(routeKey(route));
    if (!shouldRetryUpstream(result.status, settings)) break;
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
  await settleTpm(0);
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
  openAiEndpoint?: ProxyRequest["openAiEndpoint"];
  body: string;
  requestHeaders?: Headers;
  releaseSlot?: () => void;
  settleTpm?: (actualTokens: number | null) => Promise<void>;
  fallbackReason?: string;
  attempts?: { channel: string; error: string; status: number }[];
  upstreamRequestId?: string | null;
  requiredCapabilities?: string[];
  capabilityProfile?: string[];
};

type ProxyResponseInfo = {
  status: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  cacheTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  responseBody?: string;
  responseContentType?: string;
};

type ResponseProcessResult =
  | { ok: true; response: Response; info: ProxyResponseInfo }
  | { ok: false; reason: "empty" | "upstream_error"; message: string; info: ProxyResponseInfo; fallbackResponse?: Response };

type StreamPrelude = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  enc: TextEncoder;
  dec: TextDecoder;
  streamConverter: ReturnType<typeof createSseResponseConverter>;
  initialChunks: Uint8Array[];
  usageBuffer: string;
  detailBuffer: string;
  tokensIn: number;
  tokensOut: number;
  cacheTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  ttftMs: number;
  upstreamStatus: number;
  contentType: string;
};

/**
 * 在响应承诺给客户端前，只预读到"首次可见输出"或上游关闭。
 * 有可见输出后立即交给 commit 继续从同一个 reader 流式透传。
 */
async function prepareStreamResponse(
  upstream: UpstreamOk,
  ctx: Ctx,
  canTreatEmptyAsFailure: boolean,
): Promise<ResponseProcessResult> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = upstream.body.getReader();
  const streamConverter = createSseResponseConverter({ sourceType: ctx.type, targetType: ctx.targetType, openAiEndpoint: ctx.openAiEndpoint, model: ctx.inboundModel });
  const initialChunks: Uint8Array[] = [];
  let usageBuffer = "";
  let detailBuffer = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let cacheTokens = 0;
  let ttftMs = 0;
  let usageSeen = false;
  let visibleSeen = false;
  let doneSeen = false;

  try {
    while (!visibleSeen) {
      const { value, done } = await reader.read();
      if (done) {
        doneSeen = true;
        if (streamConverter) {
          const finalText = streamConverter(dec.decode(), true);
          if (finalText) {
            initialChunks.push(enc.encode(finalText));
            visibleSeen = hasVisibleStreamChunk(finalText, ctx.type);
          }
        }
        break;
      }
      if (!ttftMs) ttftMs = Date.now() - ctx.t0;
      const text = dec.decode(value, { stream: true });
      usageBuffer = appendCapped(usageBuffer, text, MAX_SSE_USAGE_BUFFER_CHARS);
      detailBuffer = appendCapped(detailBuffer, text, MAX_LOG_BODY_CHARS);
      const parsed = parseSseUsage(usageBuffer, ctx.targetType);
      if (parsed) {
        usageSeen = true;
        tokensIn = parsed.in;
        tokensOut = parsed.out;
        cacheReadTokens = parsed.cacheRead;
        cacheCreationTokens = parsed.cacheCreation;
        cacheTokens = parsed.cacheRead + parsed.cacheCreation;
      }
      if (streamConverter) {
        const converted = streamConverter(text);
        if (converted) {
          initialChunks.push(enc.encode(converted));
          visibleSeen = hasVisibleStreamChunk(converted, ctx.type);
        }
      } else {
        initialChunks.push(value);
        visibleSeen = hasVisibleStreamChunk(text, ctx.type);
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    const errorMsg = lower.includes("terminated") || lower.includes("socket") || lower.includes("econnreset") || lower.includes("other side closed")
      ? `上游流式响应中断：${msg}`
      : msg;
    if (errorMsg.startsWith("上游流式响应中断")) {
      await recordChannelObservation(ctx.channel, { ok: false, latencyMs: Date.now() - ctx.t0, error: errorMsg }, { failureStatus: "err" });
    }
    return { ok: false, reason: "empty", message: errorMsg, info: emptyStreamInfo(upstream.status, ctx) };
  }

  const usage = usageSeen ? { in: tokensIn, out: tokensOut, cacheRead: cacheReadTokens, cacheCreation: cacheCreationTokens } : null;
  const empty = doneSeen && !visibleSeen && usage && usage.out === 0;
  const info: ProxyResponseInfo = {
    status: upstream.status,
    latencyMs: Date.now() - ctx.t0,
    tokensIn, tokensOut, cacheTokens, cacheReadTokens, cacheCreationTokens,
    responseBody: detailBuffer,
    responseContentType: streamConverter ? "text/event-stream" : upstream.contentType,
  };
  if (empty && canTreatEmptyAsFailure) {
    return { ok: false, reason: "empty", message: ZERO_OUTPUT_TOKEN_ERROR, info };
  }

  const prelude: StreamPrelude = {
    reader, enc, dec, streamConverter, initialChunks, usageBuffer, detailBuffer,
    tokensIn, tokensOut, cacheTokens, cacheReadTokens, cacheCreationTokens,
    ttftMs, upstreamStatus: upstream.status, contentType: upstream.contentType,
  };
  return { ok: true, response: makeStreamResponseFromPrelude(prelude, ctx), info };
}

function hasVisibleStreamChunk(text: string, provider: Provider) {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data) as Record<string, unknown>;
      if (provider === "claude") {
        if (event.type === "content_block_start" && event.content_block && typeof event.content_block === "object") {
          const block = event.content_block as Record<string, unknown>;
          if (block.type === "tool_use") return true;
        }
        if (event.type === "content_block_delta" && event.delta && typeof event.delta === "object") {
          const delta = event.delta as Record<string, unknown>;
          if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) return true;
          if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && delta.partial_json.length > 0) return true;
        }
        continue;
      }
      if (event.type === "response.output_text.delta" && typeof event.delta === "string" && event.delta.length > 0) return true;
      if (event.type === "response.function_call_arguments.delta" && typeof event.delta === "string" && event.delta.length > 0) return true;
      if (event.type === "response.output_item.added" && event.item && typeof event.item === "object") {
        const item = event.item as Record<string, unknown>;
        if (item.type === "function_call") return true;
      }
      const choices = Array.isArray(event.choices) ? event.choices : [];
      for (const choice of choices) {
        if (!choice || typeof choice !== "object") continue;
        const delta = (choice as Record<string, unknown>).delta;
        if (!delta || typeof delta !== "object") continue;
        const d = delta as Record<string, unknown>;
        if (typeof d.content === "string" && d.content.length > 0) return true;
        if (typeof d.refusal === "string" && d.refusal.length > 0) return true;
        if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) return true;
      }
    } catch { /* ignore malformed chunk */ }
  }
  return false;
}

function emptyStreamInfo(status: number, ctx: Ctx): ProxyResponseInfo {
  return { status, latencyMs: Date.now() - ctx.t0, tokensIn: 0, tokensOut: 0, cacheTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, responseBody: "", responseContentType: "application/json" };
}

async function recordStreamFinal(logId: number, ctx: Ctx, status: number, latency: number, prelude: StreamPrelude, errorMsg: string | null) {
  const detail = errorMsg
    ? failureDetail({ requestId: ctx.requestId, type: ctx.type, status, error: errorMsg, model: ctx.model, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, keyPrefix: ctx.key.prefix, channelName: ctx.channel.name, body: ctx.body })
    : null;
  await logHub.updateAsync(logId, {
    requestId: ctx.requestId,
    ts: ctx.t0, keyId: ctx.key.id, keyName: ctx.key.name, keyPrefix: ctx.key.prefix,
    channelId: ctx.channel.id, channelName: ctx.channel.name, channelType: ctx.channel.type,
    model: ctx.model, status, latencyMs: latency,
    inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, mappingId: ctx.mappingId, mappedChannelIds: ctx.mappedChannelIds,
    ttftMs: prelude.ttftMs || latency, durationMs: latency,
    tokensIn: prelude.tokensIn, tokensOut: prelude.tokensOut,
    cacheTokens: prelude.cacheTokens, cacheReadTokens: prelude.cacheReadTokens, cacheCreationTokens: prelude.cacheCreationTokens,
    requestDetail: await requestDetail({ requestId: ctx.requestId, type: ctx.type, targetType: ctx.targetType, openAiEndpoint: ctx.openAiEndpoint, status, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders, requestBody: ctx.body, responseBody: prelude.detailBuffer, tokensIn: prelude.tokensIn, tokensOut: prelude.tokensOut, cacheReadTokens: prelude.cacheReadTokens, cacheCreationTokens: prelude.cacheCreationTokens, fallbackReason: ctx.fallbackReason, attempts: ctx.attempts, upstreamRequestId: ctx.upstreamRequestId, requiredCapabilities: ctx.requiredCapabilities, capabilityProfile: ctx.capabilityProfile }),
    errorMsg: detail,
  });
}

function makeStreamResponseFromPrelude(prelude: StreamPrelude, ctx: Ctx): Response {
  const outHeaders = new Headers();
  outHeaders.set("content-type", prelude.streamConverter ? "text/event-stream" : prelude.contentType);
  outHeaders.set("cache-control", "no-cache");
  outHeaders.set("x-accel-buffering", "no");
  outHeaders.set("x-proxy-channel-id", ctx.channel.id);
  outHeaders.set("x-proxy-model", ctx.model);
  outHeaders.set("x-request-id", ctx.requestId);

  const queue = prelude.initialChunks.slice();
  let cancelled = false;
  let logged = false;
  let released = false;
  let logId: number | null = null;

  async function ensureInitialLog() {
    if (logId !== null) return logId;
    const row = await logHub.recordAsync({
      requestId: ctx.requestId,
      ts: ctx.t0, keyId: ctx.key.id, keyName: ctx.key.name, keyPrefix: ctx.key.prefix,
      channelId: ctx.channel.id, channelName: ctx.channel.name, channelType: ctx.channel.type,
      model: ctx.model, status: prelude.upstreamStatus, latencyMs: Date.now() - ctx.t0,
      inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, mappingId: ctx.mappingId, mappedChannelIds: ctx.mappedChannelIds,
      ttftMs: prelude.ttftMs, durationMs: 0,
      tokensIn: prelude.tokensIn, tokensOut: prelude.tokensOut,
      cacheTokens: prelude.cacheTokens, cacheReadTokens: prelude.cacheReadTokens, cacheCreationTokens: prelude.cacheCreationTokens,
      requestDetail: await requestDetail({ requestId: ctx.requestId, type: ctx.type, targetType: ctx.targetType, openAiEndpoint: ctx.openAiEndpoint, status: prelude.upstreamStatus, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders, requestBody: ctx.body, fallbackReason: ctx.fallbackReason, attempts: ctx.attempts, upstreamRequestId: ctx.upstreamRequestId, requiredCapabilities: ctx.requiredCapabilities, capabilityProfile: ctx.capabilityProfile }),
      errorMsg: null,
    });
    logId = row.id;
    return logId;
  }

  function releaseSlot() {
    if (released) return;
    released = true;
    ctx.releaseSlot?.();
  }

  async function record(status: number, errorMsg: string | null) {
    if (logged) return;
    logged = true;
    const id = await ensureInitialLog();
    await recordStreamFinal(id, ctx, status, Date.now() - ctx.t0, prelude, errorMsg);
    await ctx.settleTpm?.(errorMsg ? null : prelude.tokensIn + prelude.tokensOut);
    releaseSlot();
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await ensureInitialLog();
        const queued = queue.shift();
        if (queued) {
          controller.enqueue(queued);
          return;
        }
        const { value, done } = await prelude.reader.read();
        if (done) {
          if (prelude.streamConverter) {
            const finalText = prelude.streamConverter(prelude.dec.decode(), true);
            if (finalText) controller.enqueue(prelude.enc.encode(finalText));
          }
          try { controller.close(); } catch { /* client already closed */ }
          if (!cancelled) await record(prelude.upstreamStatus, null);
          return;
        }
        const text = prelude.dec.decode(value, { stream: true });
        prelude.usageBuffer = appendCapped(prelude.usageBuffer, text, MAX_SSE_USAGE_BUFFER_CHARS);
        prelude.detailBuffer = appendCapped(prelude.detailBuffer, text, MAX_LOG_BODY_CHARS);
        const parsed = parseSseUsage(prelude.usageBuffer, ctx.targetType);
        if (parsed) {
          prelude.tokensIn = parsed.in;
          prelude.tokensOut = parsed.out;
          prelude.cacheReadTokens = parsed.cacheRead;
          prelude.cacheCreationTokens = parsed.cacheCreation;
          prelude.cacheTokens = parsed.cacheRead + parsed.cacheCreation;
        }
        if (prelude.streamConverter) {
          const converted = prelude.streamConverter(text);
          if (converted) controller.enqueue(prelude.enc.encode(converted));
        } else {
          controller.enqueue(value);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const lower = msg.toLowerCase();
        if (cancelled || lower.includes("abort") || lower.includes("cancel") || lower.includes("invalid state")) {
          await record(499, cancelled ? "客户端取消/连接中断" : `客户端取消/连接中断：${msg}`);
          return;
        }
        const errorMsg = lower.includes("terminated") || lower.includes("socket") || lower.includes("econnreset") || lower.includes("other side closed")
          ? `上游流式响应中断：${msg}`
          : msg;
        if (errorMsg.startsWith("上游流式响应中断")) {
          await recordChannelObservation(ctx.channel, { ok: false, latencyMs: Date.now() - ctx.t0, error: errorMsg }, { failureStatus: "err" });
        }
        await record(errorMsg.startsWith("上游流式响应中断") ? 502 : 0, errorMsg);
        try { controller.error(e); } catch { /* client already closed */ }
      }
    },
    cancel() {
      cancelled = true;
      try { prelude.reader.cancel(); } catch { /* */ }
      void record(499, "客户端取消/连接中断");
    },
  });
  return new Response(stream, { status: prelude.upstreamStatus, headers: outHeaders });
}

/** 兼容旧入口：直接把上游交给客户端（不预读）。当前主路径已迁移到 prepare/commit，仅保留类型兼容。 */
async function pipeStreamResponse(
  upstream: UpstreamOk,
  ctx: Ctx,
): Promise<{ response: Response; info: ProxyResponseInfo }> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = upstream.body.getReader();
  const streamConverter = createSseResponseConverter({ sourceType: ctx.type, targetType: ctx.targetType, openAiEndpoint: ctx.openAiEndpoint, model: ctx.inboundModel });
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
    await recordChannelObservation(ctx.channel, { ok: false, latencyMs: latency, error: errorMsg }, { failureStatus: "err" });
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
      requestDetail: await requestDetail({ requestId: ctx.requestId, type: ctx.type, targetType: ctx.targetType, openAiEndpoint: ctx.openAiEndpoint, status, inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders, requestBody: ctx.body, responseBody: detailBuffer, tokensIn, tokensOut, cacheReadTokens, cacheCreationTokens, fallbackReason: ctx.fallbackReason }),
      errorMsg: detail,
    });
    releaseSlot();
  }

  function releaseSlot() {
    if (released) return;
    released = true;
    ctx.releaseSlot?.();
  }

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
        if (!ttftMs) ttftMs = Date.now() - ctx.t0;
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
  canTreatEmptyAsFailure: boolean,
): Promise<ResponseProcessResult> {
  const text = await streamToString(upstream.body);
  const latency = Date.now() - ctx.t0;
  const usage = extractUsage(text, ctx.targetType);
  let responseText = text;
  let responseContentType = upstream.contentType;
  if (ctx.type !== ctx.targetType) {
    responseText = convertResponseBody({ sourceType: ctx.type, targetType: ctx.targetType, openAiEndpoint: ctx.openAiEndpoint, body: text, model: ctx.inboundModel });
    responseContentType = "application/json";
  }
  const tokensIn = usage?.in ?? 0;
  const tokensOut = usage?.out ?? 0;
  const cacheRead = usage?.cacheRead ?? 0;
  const cacheCreation = usage?.cacheCreation ?? 0;
  const info: ProxyResponseInfo = {
    status: upstream.status,
    latencyMs: latency,
    tokensIn, tokensOut,
    cacheTokens: cacheRead + cacheCreation,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
    responseBody: responseText,
    responseContentType,
  };

  const verdict = isEmptyUpstreamOutput(text, usage, ctx.targetType);
  if (verdict.empty && canTreatEmptyAsFailure) {
    return { ok: false, reason: "empty", message: verdict.message, info };
  }

  const outHeaders = new Headers();
  outHeaders.set("content-type", responseContentType);
  outHeaders.set("x-proxy-channel-id", ctx.channel.id);
  outHeaders.set("x-proxy-model", ctx.model);
  outHeaders.set("x-request-id", ctx.requestId);

  return {
    ok: true,
    response: new Response(responseText, { status: upstream.status, headers: outHeaders }),
    info,
  };
}

/** 把非流式响应结果写成最终日志（成功 / 放行空输出 都走这里）。 */
async function recordSuccessOrAcceptedEmpty(ctx: Ctx, info: ProxyResponseInfo, errorMsg: string | null) {
  await logHub.recordAsync({
    requestId: ctx.requestId,
    ts: ctx.t0, keyId: ctx.key.id, keyName: ctx.key.name, keyPrefix: ctx.key.prefix,
    channelId: ctx.channel.id, channelName: ctx.channel.name, channelType: ctx.channel.type,
    model: ctx.model, status: info.status, latencyMs: info.latencyMs,
    inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel, mappingId: ctx.mappingId, mappedChannelIds: ctx.mappedChannelIds,
    ttftMs: info.latencyMs, durationMs: info.latencyMs,
    tokensIn: info.tokensIn, tokensOut: info.tokensOut,
    cacheTokens: info.cacheTokens,
    cacheReadTokens: info.cacheReadTokens,
    cacheCreationTokens: info.cacheCreationTokens,
    requestDetail: await requestDetail({
      requestId: ctx.requestId, type: ctx.type, targetType: ctx.targetType, openAiEndpoint: ctx.openAiEndpoint, status: info.status,
      inboundModel: ctx.inboundModel, upstreamModel: ctx.upstreamModel,
      channelName: ctx.channel.name, requestHeaders: ctx.requestHeaders,
      requestBody: ctx.body, responseBody: info.responseBody,
      tokensIn: info.tokensIn, tokensOut: info.tokensOut,
      cacheReadTokens: info.cacheReadTokens, cacheCreationTokens: info.cacheCreationTokens,
      fallbackReason: ctx.fallbackReason,
      attempts: ctx.attempts,
      upstreamRequestId: ctx.upstreamRequestId,
      requiredCapabilities: ctx.requiredCapabilities,
      capabilityProfile: ctx.capabilityProfile,
    }),
    errorMsg,
  });
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

function extractUsage(body: string, type: Provider): UsageTokens | null {
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
  // 缺失 usage：可能是第三方聚合器或协议转换没带 usage；不要因此当作"空输出"。
  return null;
}

type EmptyOutputVerdict =
  | { empty: false }
  | { empty: true; reason: "empty_text_and_zero_usage"; message: string };

/**
 * 判定"上游 200 但几乎没产生可消费输出"。
 * 保守规则（必须同时满足才判空）：
 *   - usage 存在（缺失即放过，避免误伤无 usage 的聚合器）
 *   - usage.out === 0
 *   - 响应中没有任何可见 assistant 内容（Anthropic content[].text / OpenAI message.content / output_text 都为空）
 */
function isEmptyUpstreamOutput(text: string, usage: UsageTokens | null, provider: Provider): EmptyOutputVerdict {
  if (!usage) return { empty: false };
  if (usage.out > 0 || hasOpenAiData(text, provider)) return { empty: false };
  const visible = extractOutputText(text, provider).trim();
  if (visible.length > 0) return { empty: false };
  return { empty: true, reason: "empty_text_and_zero_usage", message: ZERO_OUTPUT_TOKEN_ERROR };
}

function hasOpenAiData(text: string, provider: Provider) {
  if (provider !== "openai") return false;
  try {
    const data = JSON.parse(text).data;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** 从非流式响应体抽取 assistant 可见文本。仅作空输出判定用途，不用于回显。 */
function extractOutputText(text: string, provider: Provider): string {
  try {
    const d = JSON.parse(text);
    if (provider === "claude") {
      const content = Array.isArray(d.content) ? d.content : [];
      return content
        .map((block: Record<string, unknown>) => (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") ? block.text : "")
        .join("");
    }
    const choices = Array.isArray(d.choices) ? d.choices : [];
    const parts: string[] = [];
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const c = choice as Record<string, unknown>;
      const message = c.message && typeof c.message === "object" ? c.message as Record<string, unknown> : null;
      if (message) {
        if (typeof message.content === "string") parts.push(message.content);
        const refusal = typeof message.refusal === "string" ? message.refusal : "";
        if (refusal) parts.push(refusal);
      }
      if (typeof c.text === "string") parts.push(c.text);
      if (Array.isArray(c.output_text)) parts.push(c.output_text.filter((s: unknown): s is string => typeof s === "string").join(""));
      if (typeof c.output_text === "string") parts.push(c.output_text);
    }
    return parts.join("");
  } catch {
    return "";
  }
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

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { pgDb, pgSchema } from "@/lib/db/pg";
import { usePostgres } from "@/lib/db/runtime";
import { resolveApiKeyAsync } from "@/lib/proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_TAVILY_MCP_URL = "https://mcp.tavily.com/mcp/";
const URL_KEY_PARAMS = ["key", "apiKey", "token", "tavilyApiKey"];
const FORWARD_HEADERS = ["accept", "content-type", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
const USAGE_SETTING_PREFIX = "tavily_usage:";

type Channel = typeof schema.channels.$inferSelect;
type TavilyUsage = {
  remaining?: number;
  quota?: number;
  used?: number;
  lastCredits?: number;
  source?: "headers" | "body";
  updatedAt?: number;
};

export async function GET(req: NextRequest) { return proxyTavily(req); }
export async function POST(req: NextRequest) { return proxyTavily(req); }
export async function DELETE(req: NextRequest) { return proxyTavily(req); }
export async function OPTIONS() { return new Response(null, { status: 204 }); }

async function proxyTavily(req: NextRequest) {
  const resolved = await resolveApiKeyAsync(authFromRequest(req));
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  if (resolved.key.channelScope !== "all" && resolved.key.channelScope !== "tavily") {
    return NextResponse.json({ error: "该密钥不允许调用 Tavily" }, { status: 403 });
  }

  const channel = await selectTavilyChannel(resolved.key.channelId);
  if (!channel) return NextResponse.json({ error: "没有可用的 Tavily 渠道" }, { status: 503 });

  const upstreamUrl = new URL(channel.baseUrl || DEFAULT_TAVILY_MCP_URL);
  for (const param of URL_KEY_PARAMS) upstreamUrl.searchParams.delete(param);
  upstreamUrl.searchParams.set("tavilyApiKey", channel.apiKey);
  for (const [key, value] of req.nextUrl.searchParams) {
    if (!URL_KEY_PARAMS.includes(key)) upstreamUrl.searchParams.append(key, value);
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: forwardHeaders(req.headers),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      signal: req.signal,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const headerUsage = extractTavilyUsageFromHeaders(upstream.headers);
    if (headerUsage) void recordTavilyUsage(channel.id, headerUsage);
    else if (isJsonResponse(upstream.headers)) void recordBodyUsage(channel.id, upstream.clone());
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders(upstream.headers, headerUsage) });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message.includes("abort") ? "请求已取消" : "Tavily 上游请求失败" }, { status: 502 });
  }
}

function authFromRequest(req: NextRequest) {
  for (const param of URL_KEY_PARAMS) {
    const value = req.nextUrl.searchParams.get(param);
    if (value) return value;
  }
  return req.headers.get("authorization") ?? req.headers.get("x-api-key") ?? req.headers.get("api-key");
}

async function selectTavilyChannel(channelId: string | null): Promise<Channel | null> {
  const rows = usePostgres()
    ? await pgDb.select().from(pgSchema.channels)
    : db.select().from(schema.channels).all();
  return weightedPick((rows as Channel[]).filter(channel => {
    if ((channel.type as string) !== "tavily" || !channel.enabled) return false;
    return !channelId || channel.id === channelId;
  }));
}

function weightedPick(channels: Channel[]) {
  if (!channels.length) return null;
  const total = channels.reduce((sum, channel) => sum + Math.max(1, channel.weight), 0);
  let cursor = Math.floor(Math.random() * total);
  for (const channel of channels) {
    cursor -= Math.max(1, channel.weight);
    if (cursor < 0) return channel;
  }
  return channels[0];
}

function forwardHeaders(headers: Headers) {
  const out = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = headers.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

function responseHeaders(headers: Headers, usage: TavilyUsage | null = null) {
  const out = new Headers();
  for (const name of ["content-type", "cache-control", "mcp-session-id"]) {
    const value = headers.get(name);
    if (value) out.set(name, value);
  }
  if (usage?.remaining !== undefined) out.set("x-proxy-tavily-remaining", String(usage.remaining));
  if (usage?.used !== undefined) out.set("x-proxy-tavily-used", String(usage.used));
  if (usage?.quota !== undefined) out.set("x-proxy-tavily-quota", String(usage.quota));
  if (usage?.lastCredits !== undefined) out.set("x-proxy-tavily-last-credits", String(usage.lastCredits));
  return out;
}

function extractTavilyUsageFromHeaders(headers: Headers): TavilyUsage | null {
  const usage: TavilyUsage = { source: "headers" };
  usage.remaining = firstNumber(headers, ["x-ratelimit-remaining", "x-rate-limit-remaining", "x-credits-remaining", "x-tavily-credits-remaining", "x-tavily-quota-remaining"]);
  usage.used = firstNumber(headers, ["x-tavily-credits-used", "x-tavily-quota-used"]);
  usage.quota = firstNumber(headers, ["x-tavily-credits-limit", "x-tavily-quota-limit", "x-ratelimit-limit", "x-rate-limit-limit"]);
  return hasUsage(usage) ? usage : null;
}

function firstNumber(headers: Headers, names: string[]) {
  for (const name of names) {
    const n = numeric(headers.get(name));
    if (n !== undefined) return n;
  }
}

async function recordBodyUsage(channelId: string, response: Response) {
  try {
    const usage = extractTavilyUsageFromJson(await response.json());
    if (usage) await recordTavilyUsage(channelId, usage);
  } catch { /* upstream body is still proxied; quota parsing is best-effort */ }
}

function extractTavilyUsageFromJson(data: unknown): TavilyUsage | null {
  const direct = creditsFrom(data);
  if (direct !== undefined) return { lastCredits: direct, source: "body" };
  if (!data || typeof data !== "object") return null;
  const content = (data as { content?: unknown }).content;
  const text = Array.isArray(content)
    ? content.map(item => typeof item === "object" && item && "text" in item ? (item as { text?: unknown }).text : null).find((x): x is string => typeof x === "string")
    : null;
  if (!text) return null;
  try {
    const wrapped = creditsFrom(JSON.parse(text));
    return wrapped === undefined ? null : { lastCredits: wrapped, source: "body" };
  } catch { return null; }
}

function creditsFrom(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as { usage?: { credits?: unknown }; result?: { usage?: { credits?: unknown } } };
  return numeric(obj.usage?.credits) ?? numeric(obj.result?.usage?.credits);
}

async function recordTavilyUsage(channelId: string, usage: TavilyUsage) {
  if (!hasUsage(usage)) return;
  const key = USAGE_SETTING_PREFIX + channelId;
  const previous = await readTavilyUsage(channelId);
  const next = { ...previous, ...usage, updatedAt: Date.now() };
  const value = JSON.stringify(next);
  if (usePostgres()) {
    await pgDb.insert(pgSchema.settings)
      .values({ key, value, updatedAt: next.updatedAt })
      .onConflictDoUpdate({ target: pgSchema.settings.key, set: { value, updatedAt: next.updatedAt } });
    return;
  }
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (row) db.update(schema.settings).set({ value, updatedAt: next.updatedAt }).where(eq(schema.settings.key, key)).run();
  else db.insert(schema.settings).values({ key, value, updatedAt: next.updatedAt }).run();
}

async function readTavilyUsage(channelId: string): Promise<TavilyUsage> {
  const key = USAGE_SETTING_PREFIX + channelId;
  const value = usePostgres()
    ? (await pgDb.select().from(pgSchema.settings).where(eq(pgSchema.settings.key, key)).limit(1))[0]?.value
    : db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value;
  if (!value) return {};
  try { return JSON.parse(value) as TavilyUsage; }
  catch { return {}; }
}

function hasUsage(usage: TavilyUsage) {
  return usage.remaining !== undefined || usage.quota !== undefined || usage.used !== undefined || usage.lastCredits !== undefined;
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function isJsonResponse(headers: Headers) {
  return headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;
}

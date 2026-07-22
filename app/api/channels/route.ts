import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { ensureChannelMonitor } from "@/lib/channel-monitor";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { AuthError, requireAdmin } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";
import { pageParams, pageRows, queryText, sortRows } from "@/lib/pagination";
import { validateCapabilities } from "@/lib/protocol-capabilities";
import { validateUpstreamBaseUrl } from "@/lib/upstream";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    ensureChannelMonitor();
    const { hasPagination, page, pageSize } = pageParams(req.nextUrl);
    const q = queryText(req.nextUrl, "query", "search").toLowerCase();
    const type = req.nextUrl.searchParams.get("type") ?? "all";
    const status = req.nextUrl.searchParams.get("status") ?? "all";
    const enabled = req.nextUrl.searchParams.get("enabled") ?? "all";
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const rows = await pgDb.select().from(pgSchema.channels).orderBy(desc(pgSchema.channels.weight), pgSchema.channels.name);
      const filtered = sortChannels(req.nextUrl, filterChannels(await withTavilyUsage(rows.map(({ apiKey, ...rest }) => rest)), q, type, status, enabled));
      return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered);
    }
    const rows = db.select().from(schema.channels).orderBy(desc(schema.channels.weight), schema.channels.name).all();
    const filtered = sortChannels(req.nextUrl, filterChannels(await withTavilyUsage(rows.map(({ apiKey, ...rest }) => rest)), q, type, status, enabled));
    return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

async function withTavilyUsage<T extends { id: string; type: string }>(rows: T[]) {
  const tavilyRows = rows.filter(row => row.type === "tavily");
  if (!tavilyRows.length) return rows;
  const settings = usePostgres()
    ? await (async () => {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      return pgDb.select().from(pgSchema.settings);
    })()
    : db.select().from(schema.settings).all();
  const values = new Map(settings.map(row => [row.key, row.value]));
  return rows.map(row => row.type === "tavily" ? { ...row, tavilyUsage: parseTavilyUsage(values.get(`tavily_usage:${row.id}`)) } : row);
}

function parseTavilyUsage(value: string | undefined) {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch { return null; }
}

function filterChannels<T extends { name: string; baseUrl: string; testModel: string; models: string[]; type: string; status: string; enabled: boolean }>(rows: T[], q: string, type: string, status: string, enabled: string) {
  return rows.filter(row => {
    const matchesQuery = !q || [row.name, row.baseUrl, row.testModel, ...row.models].some(value => value.toLowerCase().includes(q));
    const matchesType = type === "all" || row.type === type;
    const matchesStatus = status === "all" || row.status === status;
    const matchesEnabled = enabled === "all" || (enabled === "enabled" ? row.enabled : !row.enabled);
    return matchesQuery && matchesType && matchesStatus && matchesEnabled;
  });
}

function sortChannels<T extends { name: string; type: string; baseUrl: string; models: string[]; weight: number; maxConcurrency: number; monitorIntervalSec: number; testModel: string; status: string; enabled: boolean }>(url: URL, rows: T[]) {
  return sortRows(url, rows, {
    name: row => row.name,
    type: row => row.type,
    baseUrl: row => row.baseUrl,
    models: row => row.models.join(","),
    weight: row => row.weight,
    maxConcurrency: row => row.maxConcurrency,
    monitorIntervalSec: row => row.monitorIntervalSec,
    testModel: row => row.testModel,
    status: row => row.status,
    enabled: row => row.enabled,
  }, "weight", "desc");
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "请输入名称" }, { status: 400 });
  }
  if (!["claude", "openai", "tavily"].includes(body.type)) {
    return NextResponse.json({ error: "无效 type" }, { status: 400 });
  }
  if (body.openAiProtocol !== undefined && !["auto", "chat_completions", "responses"].includes(body.openAiProtocol)) {
    return NextResponse.json({ error: "无效 OpenAI 协议" }, { status: 400 });
  }
  const capabilities = validateCapabilities(body.capabilities);
  if (!capabilities.ok) return NextResponse.json({ error: capabilities.error }, { status: 400 });
  const baseUrlError = validateUpstreamBaseUrl(body.baseUrl);
  if (baseUrlError) return NextResponse.json({ error: baseUrlError }, { status: 400 });
  const row = {
    id: "c_" + nanoid(8),
    name: body.name.trim(),
    type: body.type as "claude" | "openai",
    openAiProtocol: body.type === "openai" ? (body.openAiProtocol ?? "auto") as "auto" | "chat_completions" | "responses" : "auto" as const,
    baseUrl: body.baseUrl.trim(),
    apiKey: body.apiKey ?? "sk-" + nanoid(32),
    weight: Number(body.weight) || 1,
    maxConcurrency: Math.max(0, Number(body.maxConcurrency) || 0),
    monitorIntervalSec: Math.max(0, Number(body.monitorIntervalSec) || 0),
    testModel: typeof body.testModel === "string" ? body.testModel.trim() : "",
    models: Array.isArray(body.models) ? body.models : [],
    status: "ok" as const,
    p50Ms: 0,
    errRate: 0,
    enabled: true,
    capabilities: capabilities.capabilities ?? [],
  };
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      await pgDb.insert(pgSchema.channels).values(row as typeof pgSchema.channels.$inferInsert);
      await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `添加渠道 ${row.name}`, actor: actor.username });
      const { apiKey, ...rest } = row;
      return NextResponse.json(rest, { status: 201 });
    }
    db.insert(schema.channels).values(row as typeof schema.channels.$inferInsert).run();
    db.insert(schema.activities).values({
      ts: Date.now(),
      event: `添加渠道 ${row.name}`,
      actor: actor.username,
    }).run();
    const { apiKey, ...rest } = row;
    return NextResponse.json(rest, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : "未知错误";
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "名称已存在" }, { status: 409 });
    return NextResponse.json({ error: "操作失败，请稍后重试" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { nanoid } from "nanoid";
import { AuthError, requireAdmin } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";
import { eq } from "drizzle-orm";
import { pageParams, pageRows, queryText, sortRows } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { hasPagination, page, pageSize } = pageParams(req.nextUrl);
    const q = queryText(req.nextUrl, "query", "search").toLowerCase();
    const provider = req.nextUrl.searchParams.get("provider") ?? "all";
    const channelId = req.nextUrl.searchParams.get("channelId") ?? "all";
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const rows = await pgDb.select().from(pgSchema.modelMappings).orderBy(pgSchema.modelMappings.createdAt);
      const filtered = sortMappings(req.nextUrl, filterMappings(rows, q, provider, channelId));
      return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered);
    }
    const rows = db.select().from(schema.modelMappings).orderBy(schema.modelMappings.createdAt).all();
    const filtered = sortMappings(req.nextUrl, filterMappings(rows, q, provider, channelId));
    return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function filterMappings<T extends { provider: string; inboundModel: string; upstreamModel: string; channelIds: string[] }>(rows: T[], q: string, provider: string, channelId: string) {
  return rows.filter(row => {
    const matchesQuery = !q || [row.inboundModel, row.upstreamModel, ...row.channelIds].some(value => value.toLowerCase().includes(q));
    const matchesProvider = provider === "all" || row.provider === provider;
    const matchesChannel = channelId === "all" || (channelId === "__all_channels" ? !row.channelIds.length : row.channelIds.includes(channelId));
    return matchesQuery && matchesProvider && matchesChannel;
  });
}

function sortMappings<T extends { provider: string; inboundModel: string; upstreamModel: string; channelIds: string[]; createdAt: number }>(url: URL, rows: T[]) {
  return sortRows(url, rows, {
    provider: row => row.provider,
    inboundModel: row => row.inboundModel,
    upstreamModel: row => row.upstreamModel,
    channels: row => row.channelIds.join(","),
    createdAt: row => row.createdAt,
  }, "createdAt", "desc");
}

function validatedChannelIds(input: unknown, provider: "claude" | "openai") {
  const ids = Array.isArray(input)
    ? [...new Set(input.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0).map(x => x.trim()))]
    : [];
  if (ids.length === 0) return { ok: true as const, ids };
  const channels = db.select().from(schema.channels).all();
  const byId = new Map(channels.map(c => [c.id, c]));
  const invalid = ids.filter(id => !byId.has(id));
  if (invalid.length) return { ok: false as const, error: `渠道不存在：${invalid.join(", ")}` };
  const wrongType = ids.filter(id => byId.get(id)?.type !== provider);
  if (wrongType.length) return { ok: false as const, error: `绑定渠道与服务商不一致：${wrongType.map(id => byId.get(id)?.name ?? id).join(", ")}` };
  return { ok: true as const, ids };
}

async function validatedChannelIdsAsync(input: unknown, provider: "claude" | "openai") {
  if (!usePostgres()) return validatedChannelIds(input, provider);
  const ids = Array.isArray(input)
    ? [...new Set(input.filter((x: unknown): x is string => typeof x === "string" && x.trim().length > 0).map(x => x.trim()))]
    : [];
  if (ids.length === 0) return { ok: true as const, ids };
  const { pgDb, pgSchema } = await import("@/lib/db/pg");
  const channels = await pgDb.select().from(pgSchema.channels);
  const byId = new Map(channels.map(c => [c.id, c]));
  const invalid = ids.filter(id => !byId.has(id));
  if (invalid.length) return { ok: false as const, error: `渠道不存在：${invalid.join(", ")}` };
  const wrongType = ids.filter(id => byId.get(id)?.type !== provider);
  if (wrongType.length) return { ok: false as const, error: `绑定渠道与服务商不一致：${wrongType.map(id => byId.get(id)?.name ?? id).join(", ")}` };
  return { ok: true as const, ids };
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => ({}));
  if (body.provider !== "claude" && body.provider !== "openai") {
    return NextResponse.json({ error: "请选择服务商" }, { status: 400 });
  }
  const inboundModel = typeof body.inboundModel === "string" ? body.inboundModel.trim() : "";
  const upstreamModel = typeof body.upstreamModel === "string" ? body.upstreamModel.trim() : "";
  if (!inboundModel) return NextResponse.json({ error: "请输入入站模型" }, { status: 400 });
  if (!upstreamModel) return NextResponse.json({ error: "请输入上游模型" }, { status: 400 });
  const channelIds = await validatedChannelIdsAsync(body.channelIds, body.provider);
  if (!channelIds.ok) return NextResponse.json({ error: channelIds.error }, { status: 400 });

  const row = {
    id: "mm_" + nanoid(8),
    provider: body.provider as "claude" | "openai",
    inboundModel,
    upstreamModel,
    channelIds: channelIds.ids,
    createdAt: Date.now(),
  };

    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      await pgDb.insert(pgSchema.modelMappings).values(row);
      await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `添加模型映射 ${row.provider}:${row.inboundModel} -> ${row.upstreamModel}`, actor: actor.username });
      return NextResponse.json(row, { status: 201 });
    }

    db.insert(schema.modelMappings).values(row).run();
    db.insert(schema.activities).values({
      ts: Date.now(),
      event: `添加模型映射 ${row.provider}:${row.inboundModel} -> ${row.upstreamModel}`,
      actor: actor.username,
    }).run();
    return NextResponse.json(row, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "映射已存在" }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

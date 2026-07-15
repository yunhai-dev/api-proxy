import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { nanoid } from "nanoid";
import { AuthError, requireAdmin } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";
import { eq, inArray } from "drizzle-orm";
import { pageParams, pageRows, queryText, sortRows } from "@/lib/pagination";
import { groupMappings, normalizeInboundModels, type MappingRow } from "@/lib/model-mapping-groups";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { hasPagination, page, pageSize } = pageParams(req.nextUrl);
    const q = queryText(req.nextUrl, "query", "search").toLowerCase();
    const provider = req.nextUrl.searchParams.get("provider") ?? "all";
    const channelId = req.nextUrl.searchParams.get("channelId") ?? "all";
    const grouped = req.nextUrl.searchParams.get("view") === "groups";
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const rows = await pgDb.select().from(pgSchema.modelMappings).orderBy(pgSchema.modelMappings.createdAt);
      const source: MappingListRow[] = grouped ? groupMappings(rows as MappingRow[]) : rows;
      const filtered = sortMappings(req.nextUrl, filterMappings(source, q, provider, channelId));
      return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered);
    }
    const rows = db.select().from(schema.modelMappings).orderBy(schema.modelMappings.createdAt).all();
    const source = grouped ? groupMappings(rows as MappingRow[]) : rows;
    const filtered = sortMappings(req.nextUrl, filterMappings(source, q, provider, channelId));
    return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

type MappingListRow = {
  provider: string;
  targetProvider?: string;
  inboundModel?: string;
  inboundModels?: string[];
  upstreamModel: string;
  channelIds: string[];
  enabled?: boolean;
  createdAt: number;
};

function filterMappings<T extends MappingListRow>(rows: T[], q: string, provider: string, channelId: string) {
  return rows.filter(row => {
    const inboundModels = row.inboundModels ?? [row.inboundModel ?? ""];
    const matchesQuery = !q || [row.provider, row.targetProvider ?? row.provider, ...inboundModels, row.upstreamModel, ...row.channelIds].some(value => value.toLowerCase().includes(q));
    const matchesProvider = provider === "all" || row.provider === provider;
    const matchesChannel = channelId === "all" || (channelId === "__all_channels" ? !row.channelIds.length : row.channelIds.includes(channelId));
    return matchesQuery && matchesProvider && matchesChannel;
  });
}

function sortMappings<T extends MappingListRow>(url: URL, rows: T[]) {
  return sortRows(url, rows, {
    provider: row => row.provider,
    targetProvider: row => row.targetProvider ?? row.provider,
    inboundModel: row => (row.inboundModels ?? [row.inboundModel ?? ""]).join(","),
    upstreamModel: row => row.upstreamModel,
    channels: row => row.channelIds.join(","),
    enabled: row => row.enabled ?? true,
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

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids)
      ? [...new Set<string>(body.ids.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0).map((id: string) => id.trim()))]
      : [];
    if (!ids.length) return NextResponse.json({ error: "请选择要删除的映射" }, { status: 400 });

    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const selected = await pgDb.select().from(pgSchema.modelMappings).where(inArray(pgSchema.modelMappings.id, ids));
      if (!selected.length) return NextResponse.json({ deleted: 0, groups: 0 });
      const groupIds = [...new Set(selected.map(row => row.groupId).filter((id): id is string => !!id))];
      const groupedRows = groupIds.length
        ? await pgDb.select().from(pgSchema.modelMappings).where(inArray(pgSchema.modelMappings.groupId, groupIds))
        : [];
      const deleteIds = [...new Set([
        ...selected.filter(row => !row.groupId).map(row => row.id),
        ...groupedRows.map(row => row.id),
      ])];
      await pgDb.transaction(async tx => {
        await tx.delete(pgSchema.modelMappings).where(inArray(pgSchema.modelMappings.id, deleteIds));
        await tx.insert(pgSchema.activities).values({ ts: Date.now(), event: `批量删除 ${selected.length} 组模型映射（${deleteIds.length} 条路由）`, actor: actor.username });
      });
      return NextResponse.json({ deleted: deleteIds.length, groups: selected.length });
    }

    const selected = db.select().from(schema.modelMappings).where(inArray(schema.modelMappings.id, ids)).all();
    const groupIds = [...new Set(selected.map(row => row.groupId).filter((id: unknown): id is string => typeof id === "string" && !!id))];
    const groupedRows = groupIds.length ? db.select().from(schema.modelMappings).where(inArray(schema.modelMappings.groupId, groupIds)).all() : [];
    const deleteIds = [...new Set([...selected.filter(row => !row.groupId).map(row => row.id), ...groupedRows.map(row => row.id)])];
    if (deleteIds.length) db.delete(schema.modelMappings).where(inArray(schema.modelMappings.id, deleteIds)).run();
    if (selected.length) db.insert(schema.activities).values({ ts: Date.now(), event: `批量删除 ${selected.length} 组模型映射（${deleteIds.length} 条路由）`, actor: actor.username }).run();
    return NextResponse.json({ deleted: deleteIds.length, groups: selected.length });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => ({}));
  if (body.provider !== "claude" && body.provider !== "openai") {
    return NextResponse.json({ error: "请选择服务商" }, { status: 400 });
  }
  const targetProvider = body.targetProvider === "claude" || body.targetProvider === "openai" ? body.targetProvider as "claude" | "openai" : body.provider as "claude" | "openai";
  const inboundModels = normalizeInboundModels(body.inboundModels, body.inboundModel);
  const upstreamModel = typeof body.upstreamModel === "string" ? body.upstreamModel.trim() : "";
  if (!inboundModels.length) return NextResponse.json({ error: "请输入入站模型" }, { status: 400 });
  if (!upstreamModel) return NextResponse.json({ error: "请输入上游模型" }, { status: 400 });
  const channelIds = await validatedChannelIdsAsync(body.channelIds, targetProvider);
  if (!channelIds.ok) return NextResponse.json({ error: channelIds.error }, { status: 400 });

  const now = Date.now();
  const groupId = inboundModels.length > 1 ? "mmg_" + nanoid(8) : null;
  const rows = inboundModels.map((inboundModel, index) => ({
    id: "mm_" + nanoid(8),
    groupId,
    provider: body.provider as "claude" | "openai",
    targetProvider,
    inboundModel,
    upstreamModel,
    channelIds: channelIds.ids,
    enabled: body.enabled !== false,
    createdAt: now + index,
  }));

    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      await pgDb.transaction(async tx => {
        await tx.insert(pgSchema.modelMappings).values(rows);
        await tx.insert(pgSchema.activities).values({ ts: now, event: `添加模型映射 ${rows[0].provider}:${inboundModels.join(", ")} -> ${targetProvider}:${upstreamModel}`, actor: actor.username });
      });
      const result = Array.isArray(body.inboundModels) ? groupMappings(rows as MappingRow[])[0] : rows[0];
      return NextResponse.json(result, { status: 201 });
    }

    for (const row of rows) db.insert(schema.modelMappings).values(row).run();
    db.insert(schema.activities).values({
      ts: now,
      event: `添加模型映射 ${rows[0].provider}:${inboundModels.join(", ")} -> ${targetProvider}:${upstreamModel}`,
      actor: actor.username,
    }).run();
    const result = Array.isArray(body.inboundModels) ? groupMappings(rows as MappingRow[])[0] : rows[0];
    return NextResponse.json(result, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "数据库仍存在旧唯一索引，请同步 schema 后重试" }, { status: 409 });
    return NextResponse.json({ error: "操作失败，请稍后重试" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireAdmin } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";
import { groupMappings, normalizeInboundModels, type MappingRow } from "@/lib/model-mapping-groups";

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

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actor = await requireAdmin();
  const body = await req.json().catch(() => ({}));

  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    const row = (await pgDb.select().from(pgSchema.modelMappings).where(eq(pgSchema.modelMappings.id, id)).limit(1))[0];
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    const members = row.groupId
      ? await pgDb.select().from(pgSchema.modelMappings).where(eq(pgSchema.modelMappings.groupId, row.groupId))
      : [row];
    const inboundModels = normalizeInboundModels(body.inboundModels, body.inboundModel ?? row.inboundModel);
    const targetProvider = body.targetProvider === "claude" || body.targetProvider === "openai" ? body.targetProvider : row.targetProvider;
    const upstreamModel = typeof body.upstreamModel === "string" ? body.upstreamModel.trim() : row.upstreamModel;
    if (!inboundModels.length) return NextResponse.json({ error: "请输入入站模型" }, { status: 400 });
    if (!upstreamModel) return NextResponse.json({ error: "请输入上游模型" }, { status: 400 });
    const channelIds = await validatedChannelIdsAsync(body.channelIds ?? row.channelIds, targetProvider);
    if (!channelIds.ok) return NextResponse.json({ error: channelIds.error }, { status: 400 });
    const enabled = typeof body.enabled === "boolean" ? body.enabled : row.enabled;
    const groupId = row.groupId ?? (inboundModels.length > 1 ? "mmg_" + nanoid(8) : null);
    const byInbound = new Map(members.map(member => [member.inboundModel, member]));
    const retained = inboundModels.map(inboundModel => byInbound.get(inboundModel)).filter((member): member is typeof row => !!member);
    const removedIds = members.filter(member => !inboundModels.includes(member.inboundModel)).map(member => member.id);
    const added = inboundModels.filter(inboundModel => !byInbound.has(inboundModel)).map((inboundModel, index) => ({
      id: "mm_" + nanoid(8), groupId, provider: row.provider, targetProvider, inboundModel, upstreamModel,
      channelIds: channelIds.ids, enabled, createdAt: Date.now() + index,
    }));
    try {
      await pgDb.transaction(async tx => {
        if (retained.length) await tx.update(pgSchema.modelMappings).set({ groupId, targetProvider, upstreamModel, channelIds: channelIds.ids, enabled }).where(inArray(pgSchema.modelMappings.id, retained.map(member => member.id)));
        if (removedIds.length) await tx.delete(pgSchema.modelMappings).where(inArray(pgSchema.modelMappings.id, removedIds));
        if (added.length) await tx.insert(pgSchema.modelMappings).values(added);
        await tx.insert(pgSchema.activities).values({ ts: Date.now(), event: `更新模型映射 ${row.provider}:${inboundModels.join(", ")} -> ${targetProvider}:${upstreamModel}`, actor: actor.username });
      });
      const resultRows = [...retained.map(member => ({ ...member, groupId, targetProvider, upstreamModel, channelIds: channelIds.ids, enabled })), ...added] as MappingRow[];
      return NextResponse.json(groupId ? groupMappings(resultRows)[0] : resultRows[0]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate") || msg.includes("unique")) return NextResponse.json({ error: "数据库仍存在旧唯一索引，请同步 schema 后重试" }, { status: 409 });
      return NextResponse.json({ error: "操作失败，请稍后重试" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "操作失败，请稍后重试" }, { status: 500 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actor = await requireAdmin();
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    const row = (await pgDb.select().from(pgSchema.modelMappings).where(eq(pgSchema.modelMappings.id, id)).limit(1))[0];
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    const condition = row.groupId ? eq(pgSchema.modelMappings.groupId, row.groupId) : eq(pgSchema.modelMappings.id, id);
    const members = row.groupId ? await pgDb.select().from(pgSchema.modelMappings).where(condition) : [row];
    await pgDb.transaction(async tx => {
      await tx.delete(pgSchema.modelMappings).where(condition);
      await tx.insert(pgSchema.activities).values({ ts: Date.now(), event: `删除模型映射 ${row.provider}:${members.map(member => member.inboundModel).join(", ")}`, actor: actor.username });
    });
    return NextResponse.json({ ok: true, deleted: members.length });
  }
  const row = db.select().from(schema.modelMappings).where(eq(schema.modelMappings.id, id)).get();
  if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
  db.delete(schema.modelMappings).where(eq(schema.modelMappings.id, id)).run();
  db.insert(schema.activities).values({
    ts: Date.now(),
    event: `删除模型映射 ${row.provider}:${row.inboundModel}`,
    actor: actor.username,
  }).run();
  return NextResponse.json({ ok: true });
}

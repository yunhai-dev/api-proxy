import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";

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
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    const row = (await pgDb.select().from(pgSchema.modelMappings).where(eq(pgSchema.modelMappings.id, id)).limit(1))[0];
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const targetProvider = body.targetProvider === "claude" || body.targetProvider === "openai" ? body.targetProvider as "claude" | "openai" : (row.targetProvider ?? row.provider) as "claude" | "openai";
    const inboundModel = typeof body.inboundModel === "string" ? body.inboundModel.trim() : "";
    const upstreamModel = typeof body.upstreamModel === "string" ? body.upstreamModel.trim() : "";
    if (!inboundModel) return NextResponse.json({ error: "请输入入站模型" }, { status: 400 });
    if (!upstreamModel) return NextResponse.json({ error: "请输入上游模型" }, { status: 400 });
    const channelIds = await validatedChannelIdsAsync(body.channelIds, targetProvider);
    if (!channelIds.ok) return NextResponse.json({ error: channelIds.error }, { status: 400 });
    try {
      await pgDb.update(pgSchema.modelMappings).set({ targetProvider, inboundModel, upstreamModel, channelIds: channelIds.ids }).where(eq(pgSchema.modelMappings.id, id));
      await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `更新模型映射 ${row.provider}:${inboundModel} -> ${targetProvider}:${upstreamModel}`, actor: actor.username });
      return NextResponse.json({ ...row, targetProvider, inboundModel, upstreamModel, channelIds: channelIds.ids });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate") || msg.includes("unique")) return NextResponse.json({ error: "映射已存在" }, { status: 409 });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }
  const row = db.select().from(schema.modelMappings).where(eq(schema.modelMappings.id, id)).get();
  if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const targetProvider = body.targetProvider === "claude" || body.targetProvider === "openai" ? body.targetProvider as "claude" | "openai" : (row.targetProvider ?? row.provider) as "claude" | "openai";
  const inboundModel = typeof body.inboundModel === "string" ? body.inboundModel.trim() : "";
  const upstreamModel = typeof body.upstreamModel === "string" ? body.upstreamModel.trim() : "";
  if (!inboundModel) return NextResponse.json({ error: "请输入入站模型" }, { status: 400 });
  if (!upstreamModel) return NextResponse.json({ error: "请输入上游模型" }, { status: 400 });
  const channelIds = validatedChannelIds(body.channelIds, targetProvider);
  if (!channelIds.ok) return NextResponse.json({ error: channelIds.error }, { status: 400 });

  try {
    db.update(schema.modelMappings)
      .set({ targetProvider, inboundModel, upstreamModel, channelIds: channelIds.ids })
      .where(eq(schema.modelMappings.id, id))
      .run();
    db.insert(schema.activities).values({
      ts: Date.now(),
      event: `更新模型映射 ${row.provider}:${inboundModel} -> ${targetProvider}:${upstreamModel}`,
      actor: actor.username,
    }).run();
    return NextResponse.json({ ...row, targetProvider, inboundModel, upstreamModel, channelIds: channelIds.ids });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "映射已存在" }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const actor = await requireAdmin();
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    const row = (await pgDb.select().from(pgSchema.modelMappings).where(eq(pgSchema.modelMappings.id, id)).limit(1))[0];
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    await pgDb.delete(pgSchema.modelMappings).where(eq(pgSchema.modelMappings.id, id));
    await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `删除模型映射 ${row.provider}:${row.inboundModel}`, actor: actor.username });
    return NextResponse.json({ ok: true });
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

import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { AuthError, requireAdmin } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";
import { validateCapabilities } from "@/lib/protocol-capabilities";
import { validateUpstreamBaseUrl } from "@/lib/upstream";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const row = (await pgDb.select().from(pgSchema.channels).where(eq(pgSchema.channels.id, id)).limit(1))[0];
      if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
      const update: Partial<typeof pgSchema.channels.$inferInsert> = {};
      if (typeof body.weight === "number") update.weight = body.weight;
      if (typeof body.maxConcurrency === "number") update.maxConcurrency = Math.max(0, body.maxConcurrency);
      if (typeof body.monitorIntervalSec === "number") update.monitorIntervalSec = Math.max(0, body.monitorIntervalSec);
      if (typeof body.testModel === "string") update.testModel = body.testModel.trim();
      if (typeof body.enabled === "boolean") update.enabled = body.enabled;
      if (Array.isArray(body.models)) update.models = body.models;
      if (body.baseUrl !== undefined) {
        const baseUrlError = validateUpstreamBaseUrl(body.baseUrl);
        if (baseUrlError) return NextResponse.json({ error: baseUrlError }, { status: 400 });
        update.baseUrl = body.baseUrl.trim();
      }
      if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
      if (body.type === "claude" || body.type === "openai") update.type = body.type;
      if (typeof body.apiKey === "string" && body.apiKey.length > 0) update.apiKey = body.apiKey;
      const capabilities = validateCapabilities(body.capabilities);
      if (!capabilities.ok) return NextResponse.json({ error: capabilities.error }, { status: 400 });
      if (capabilities.capabilities) update.capabilities = capabilities.capabilities;
      if (Object.keys(update).length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
      await pgDb.update(pgSchema.channels).set(update).where(eq(pgSchema.channels.id, id));
      if (update.type && update.type !== row.type) {
        const models: string[] = Array.isArray(update.models) ? update.models : row.models;
        const scopedModels = models.filter(model => model && model !== "*");
        if (scopedModels.length > 0) {
          await pgDb.update(pgSchema.modelCatalog)
            .set({ provider: update.type, updatedAt: Date.now() })
            .where(and(eq(pgSchema.modelCatalog.provider, row.type), inArray(pgSchema.modelCatalog.model, scopedModels)));
        }
      }
      await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `更新渠道 ${row.name}`, actor: actor.username });
      return NextResponse.json({ ok: true });
    }
    const row = db.select().from(schema.channels).where(eq(schema.channels.id, id)).get();
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });

    const update: Partial<typeof schema.channels.$inferInsert> = {};
    if (typeof body.weight === "number") update.weight = body.weight;
    if (typeof body.maxConcurrency === "number") update.maxConcurrency = Math.max(0, body.maxConcurrency);
    if (typeof body.monitorIntervalSec === "number") update.monitorIntervalSec = Math.max(0, body.monitorIntervalSec);
    if (typeof body.testModel === "string") update.testModel = body.testModel.trim();
    if (typeof body.enabled === "boolean") update.enabled = body.enabled;
    if (Array.isArray(body.models)) update.models = body.models;
    if (body.baseUrl !== undefined) {
      const baseUrlError = validateUpstreamBaseUrl(body.baseUrl);
      if (baseUrlError) return NextResponse.json({ error: baseUrlError }, { status: 400 });
      update.baseUrl = body.baseUrl.trim();
    }
    if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim();
    if (body.type === "claude" || body.type === "openai") update.type = body.type;
    if (typeof body.apiKey === "string" && body.apiKey.length > 0) update.apiKey = body.apiKey;
    const capabilities = validateCapabilities(body.capabilities);
    if (!capabilities.ok) return NextResponse.json({ error: capabilities.error }, { status: 400 });
    if (capabilities.capabilities) update.capabilities = capabilities.capabilities;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "无更新字段" }, { status: 400 });
    }
    db.update(schema.channels).set(update).where(eq(schema.channels.id, id)).run();
    if (update.type && update.type !== row.type) {
      const models: string[] = Array.isArray(update.models) ? update.models : row.models;
      const scopedModels = models.filter(model => model && model !== "*");
      if (scopedModels.length > 0) {
        db.update(schema.modelCatalog)
          .set({ provider: update.type, updatedAt: Date.now() })
          .where(and(eq(schema.modelCatalog.provider, row.type), inArray(schema.modelCatalog.model, scopedModels)))
          .run();
      }
    }
    db.insert(schema.activities).values({
      ts: Date.now(),
      event: `更新渠道 ${row.name}`,
      actor: actor.username,
    }).run();
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    const row = (await pgDb.select().from(pgSchema.channels).where(eq(pgSchema.channels.id, id)).limit(1))[0];
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    await pgDb.delete(pgSchema.channels).where(eq(pgSchema.channels.id, id));
    await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `删除渠道 ${row.name}`, actor: actor.username });
    return NextResponse.json({ ok: true });
  }
  const row = db.select().from(schema.channels).where(eq(schema.channels.id, id)).get();
  if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
  db.delete(schema.channels).where(eq(schema.channels.id, id)).run();
  db.insert(schema.activities).values({
    ts: Date.now(),
    event: `删除渠道 ${row.name}`,
    actor: actor.username,
  }).run();
  return NextResponse.json({ ok: true });
}

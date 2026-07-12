import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { usePostgres } from "@/lib/db/runtime";
import { validateCapabilities } from "@/lib/protocol-capabilities";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin();
    const { id } = await ctx.params;
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const row = (await pgDb.select().from(pgSchema.modelCatalog).where(eq(pgSchema.modelCatalog.id, id)).limit(1))[0];
      if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
      const body = await req.json().catch(() => ({}));
      const capabilities = validateCapabilities(body.capabilities);
      if (!capabilities.ok) return NextResponse.json({ error: capabilities.error }, { status: 400 });
      const value = { displayName: typeof body.displayName === "string" ? body.displayName.trim() : row.displayName, visible: typeof body.visible === "boolean" ? body.visible : row.visible, enabled: typeof body.enabled === "boolean" ? body.enabled : row.enabled, capabilities: capabilities.capabilities ?? row.capabilities, updatedAt: Date.now() };
      await pgDb.update(pgSchema.modelCatalog).set(value).where(eq(pgSchema.modelCatalog.id, id));
      await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `更新模型 ${row.provider}:${row.model}`, actor: actor.username });
      return NextResponse.json({ ...row, ...value });
    }
    const row = db.select().from(schema.modelCatalog).where(eq(schema.modelCatalog.id, id)).get();
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const capabilities = validateCapabilities(body.capabilities);
    if (!capabilities.ok) return NextResponse.json({ error: capabilities.error }, { status: 400 });
    const value = {
      displayName: typeof body.displayName === "string" ? body.displayName.trim() : row.displayName,
      visible: typeof body.visible === "boolean" ? body.visible : row.visible,
      enabled: typeof body.enabled === "boolean" ? body.enabled : row.enabled,
      capabilities: capabilities.capabilities ?? row.capabilities,
      updatedAt: Date.now(),
    };
    db.update(schema.modelCatalog).set(value).where(eq(schema.modelCatalog.id, id)).run();
    db.insert(schema.activities).values({ ts: Date.now(), event: `更新模型 ${row.provider}:${row.model}`, actor: actor.username }).run();
    return NextResponse.json({ ...row, ...value });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin();
    const { id } = await ctx.params;
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const row = (await pgDb.select().from(pgSchema.modelCatalog).where(eq(pgSchema.modelCatalog.id, id)).limit(1))[0];
      if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
      await pgDb.delete(pgSchema.modelCatalog).where(eq(pgSchema.modelCatalog.id, id));
      await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `重置模型 ${row.provider}:${row.model}`, actor: actor.username });
      return NextResponse.json({ ok: true });
    }
    const row = db.select().from(schema.modelCatalog).where(eq(schema.modelCatalog.id, id)).get();
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    db.delete(schema.modelCatalog).where(eq(schema.modelCatalog.id, id)).run();
    db.insert(schema.activities).values({ ts: Date.now(), event: `重置模型 ${row.provider}:${row.model}`, actor: actor.username }).run();
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

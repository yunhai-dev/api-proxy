import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { AuthError, requireAdmin } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";

const roles = new Set(["super_admin", "admin", "user"]);

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin();
    const { id } = await ctx.params;
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    const row = (await pgDb.select().from(pgSchema.users).where(eq(pgSchema.users.id, id)).limit(1))[0];
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const update: Partial<typeof pgSchema.users.$inferInsert> = { updatedAt: Date.now() };
    if (typeof body.displayName === "string" && body.displayName.trim()) update.displayName = body.displayName.trim();
    if (typeof body.email === "string") update.email = body.email.trim();
    if (roles.has(body.role)) update.role = body.role;
    if (body.status === "pending" || body.status === "active" || body.status === "disabled") update.status = body.status;
    await pgDb.update(pgSchema.users).set(update).where(eq(pgSchema.users.id, id));
    await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `更新用户 ${row.username}`, actor: actor.username });
    return NextResponse.json({ ok: true });
  }
  const row = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const update: Partial<typeof schema.users.$inferInsert> = { updatedAt: Date.now() };
  if (typeof body.displayName === "string" && body.displayName.trim()) update.displayName = body.displayName.trim();
  if (typeof body.email === "string") update.email = body.email.trim();
  if (roles.has(body.role)) update.role = body.role;
  if (body.status === "pending" || body.status === "active" || body.status === "disabled") update.status = body.status;
  db.update(schema.users).set(update).where(eq(schema.users.id, id)).run();
    db.insert(schema.activities).values({ ts: Date.now(), event: `更新用户 ${row.username}`, actor: actor.username }).run();
    return NextResponse.json({ ok: true });
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
    const row = (await pgDb.select().from(pgSchema.users).where(eq(pgSchema.users.id, id)).limit(1))[0];
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    if (row.id === actor.id) return NextResponse.json({ error: "不能删除自己" }, { status: 400 });
    await pgDb.delete(pgSchema.users).where(eq(pgSchema.users.id, id));
    await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `删除用户 ${row.username}`, actor: actor.username });
    return NextResponse.json({ ok: true });
  }
  const row = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
  if (row.id === actor.id) return NextResponse.json({ error: "不能删除自己" }, { status: 400 });
  db.delete(schema.users).where(eq(schema.users.id, id)).run();
    db.insert(schema.activities).values({ ts: Date.now(), event: `删除用户 ${row.username}`, actor: actor.username }).run();
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

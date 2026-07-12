import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { AuthError, isAdmin, requireUser } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";
import { backfillRequestStatsForKeyAsync } from "@/lib/request-stats";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const row = (await pgDb.select().from(pgSchema.keys).where(eq(pgSchema.keys.id, id)).limit(1))[0];
      if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
      if (!isAdmin(user) && row.userId !== user.id) return NextResponse.json({ error: "无权操作该密钥" }, { status: 403 });
      const update: Partial<typeof pgSchema.keys.$inferInsert> = {};
      if (body.status === "active" || body.status === "disabled") update.status = body.status;
      if (body.channelScope === "all" || body.channelScope === "claude" || body.channelScope === "openai") update.channelScope = body.channelScope;
      if (isAdmin(user) && body.channelId !== undefined) {
        const channelId = typeof body.channelId === "string" && body.channelId ? body.channelId : null;
        const channel = channelId ? (await pgDb.select().from(pgSchema.channels).where(eq(pgSchema.channels.id, channelId)).limit(1))[0] : null;
        if (channelId && !channel?.enabled) return NextResponse.json({ error: "供应商渠道不存在或已停用" }, { status: 400 });
        update.channelId = channelId;
        if (channel) update.channelScope = channel.type;
      }
      if (body.rateLimitRpm !== undefined) update.rateLimitRpm = Math.max(0, Number(body.rateLimitRpm) || 0);
      if (body.rateLimitTpm !== undefined) update.rateLimitTpm = Math.max(0, Number(body.rateLimitTpm) || 0);
      if (body.maxConcurrency !== undefined) update.maxConcurrency = Math.max(0, Number(body.maxConcurrency) || 0);
      if (Object.keys(update).length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
      await pgDb.update(pgSchema.keys).set(update).where(eq(pgSchema.keys.id, id));
      const events = [];
      if (update.status) events.push(update.status === "active" ? `启用密钥 ${row.name}` : `停用密钥 ${row.name}`);
      if (update.channelScope) events.push(`更新密钥 ${row.name} 渠道范围为 ${update.channelScope}`);
      if (update.rateLimitRpm !== undefined || update.rateLimitTpm !== undefined || update.maxConcurrency !== undefined) events.push(`更新密钥 ${row.name} 限速配置`);
      for (const event of events) await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event, actor: user.username });
      return NextResponse.json({ ok: true });
    }
    const row = db.select().from(schema.keys).where(eq(schema.keys.id, id)).get();
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    if (!isAdmin(user) && row.userId !== user.id) return NextResponse.json({ error: "无权操作该密钥" }, { status: 403 });

    const update: Partial<typeof schema.keys.$inferInsert> = {};
    if (body.status === "active" || body.status === "disabled") update.status = body.status;
    if (body.channelScope === "all" || body.channelScope === "claude" || body.channelScope === "openai") update.channelScope = body.channelScope;
    if (isAdmin(user) && body.channelId !== undefined) {
      const channelId = typeof body.channelId === "string" && body.channelId ? body.channelId : null;
      const channel = channelId ? db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get() : null;
      if (channelId && !channel?.enabled) return NextResponse.json({ error: "供应商渠道不存在或已停用" }, { status: 400 });
      update.channelId = channelId;
      if (channel) update.channelScope = channel.type;
    }
    if (body.rateLimitRpm !== undefined) update.rateLimitRpm = Math.max(0, Number(body.rateLimitRpm) || 0);
    if (body.rateLimitTpm !== undefined) update.rateLimitTpm = Math.max(0, Number(body.rateLimitTpm) || 0);
    if (body.maxConcurrency !== undefined) update.maxConcurrency = Math.max(0, Number(body.maxConcurrency) || 0);
    if (Object.keys(update).length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

    db.update(schema.keys).set(update).where(eq(schema.keys.id, id)).run();
    const events = [];
    if (update.status) events.push(update.status === "active" ? `启用密钥 ${row.name}` : `停用密钥 ${row.name}`);
    if (update.channelScope) events.push(`更新密钥 ${row.name} 渠道范围为 ${update.channelScope}`);
    if (update.rateLimitRpm !== undefined || update.rateLimitTpm !== undefined || update.maxConcurrency !== undefined) events.push(`更新密钥 ${row.name} 限速配置`);
    for (const event of events) {
      db.insert(schema.activities).values({ ts: Date.now(), event, actor: user.username }).run();
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const row = (await pgDb.select().from(pgSchema.keys).where(eq(pgSchema.keys.id, id)).limit(1))[0];
      if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
      if (!isAdmin(user) && row.userId !== user.id) return NextResponse.json({ error: "无权操作该密钥" }, { status: 403 });
      await backfillRequestStatsForKeyAsync(row.id, row.userId);
      await pgDb.delete(pgSchema.keys).where(eq(pgSchema.keys.id, id));
      await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `删除密钥 ${row.name}`, actor: user.username });
      return NextResponse.json({ ok: true });
    }
    const row = db.select().from(schema.keys).where(eq(schema.keys.id, id)).get();
    if (!row) return NextResponse.json({ error: "未找到" }, { status: 404 });
    if (!isAdmin(user) && row.userId !== user.id) return NextResponse.json({ error: "无权操作该密钥" }, { status: 403 });
    db.delete(schema.keys).where(eq(schema.keys.id, id)).run();
    db.insert(schema.activities).values({
      ts: Date.now(),
      event: `删除密钥 ${row.name}`,
      actor: user.username,
    }).run();
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

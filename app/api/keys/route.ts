import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { AuthError, isAdmin, requireUser } from "@/lib/auth";
import { combineWhere, keyOwnerWhere, requestedUserId } from "@/lib/scope";
import { usePostgres } from "@/lib/db/runtime";
import { pageParams, pageRows, sortRows } from "@/lib/pagination";

function sk() { return "sk-relay-" + nanoid(4); }

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const status = req.nextUrl.searchParams.get("status");
    const search = req.nextUrl.searchParams.get("search")?.toLowerCase();
    const { hasPagination, page, pageSize } = pageParams(req.nextUrl);
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const requested = requestedUserId(req.nextUrl);
      const scoped = isAdmin(user) ? requested : user.id;
      let rows = await pgDb.select().from(pgSchema.keys);
      if (scoped) rows = rows.filter(k => k.userId === scoped);
      if (status === "active" || status === "disabled") rows = rows.filter(k => k.status === status);
      if (status === "exceeded") rows = rows.filter(k => k.quota > 0 && k.used >= k.quota);
      if (search) rows = rows.filter(k => k.name.toLowerCase().includes(search) || k.prefix.toLowerCase().includes(search));
      const sorted = sortKeys(req.nextUrl, rows);
      return NextResponse.json(hasPagination ? pageRows(sorted, page, pageSize) : sorted);
    }
    const owner = keyOwnerWhere(user, requestedUserId(req.nextUrl));
    const statusWhere = status === "active" || status === "disabled" ? eq(schema.keys.status, status) : undefined;

    let query = db.select().from(schema.keys).$dynamic();
    const where = combineWhere(owner, statusWhere);
    if (where) query = query.where(where);
    const rows = query.all();
    const filtered = search
      ? rows.filter(k => k.name.toLowerCase().includes(search) || k.prefix.toLowerCase().includes(search))
      : rows;
    const withExceeded = status === "exceeded" ? filtered.filter(k => k.quota > 0 && k.used >= k.quota) : filtered;
    const sorted = sortKeys(req.nextUrl, withExceeded);
    return NextResponse.json(hasPagination ? pageRows(sorted, page, pageSize) : sorted);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function sortKeys<T extends { name: string; prefix: string; userId: string; createdAt: number; lastUsedAt: number | null; channelScope: string; used: number; status: string }>(url: URL, rows: T[]) {
  return sortRows(url, rows, {
    name: row => row.name,
    prefix: row => row.prefix,
    user: row => row.userId,
    createdAt: row => row.createdAt,
    lastUsedAt: row => row.lastUsedAt ?? 0,
    channelScope: row => row.channelScope,
    used: row => row.used,
    status: row => row.status,
  }, "createdAt", "desc");
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await requireUser();
    const body = await req.json().catch(() => null);
    if (!body || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "请输入名称" }, { status: 400 });
    }
    const name = body.name.trim();
    const quota = Number(body.quota) || 0;
    const admin = isAdmin(currentUser);
    const userId = admin && typeof body.userId === "string" && body.userId ? body.userId : currentUser.id;
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const owner = (await pgDb.select().from(pgSchema.users).where(eq(pgSchema.users.id, userId)).limit(1))[0];
      if (!owner) return NextResponse.json({ error: "归属用户不存在" }, { status: 400 });
      const rateLimitRpm = Math.max(0, Number(body.rateLimitRpm) || 0);
      const rateLimitTpm = Math.max(0, Number(body.rateLimitTpm) || 0);
      const maxConcurrency = Math.max(0, Number(body.maxConcurrency) || 0);
      let channelScope = admin && (body.channelScope === "claude" || body.channelScope === "openai") ? body.channelScope : "all";
      const channelId = admin && typeof body.channelId === "string" && body.channelId ? body.channelId : null;
      if (channelId) {
        const channel = (await pgDb.select().from(pgSchema.channels).where(eq(pgSchema.channels.id, channelId)).limit(1))[0];
        if (!channel?.enabled) return NextResponse.json({ error: "供应商渠道不存在或已停用" }, { status: 400 });
        channelScope = channel.type;
      }
      const prefix = sk();
      const fullKey = prefix + "-" + nanoid(16);
      const row = { id: "k_" + nanoid(8), name, userId, prefix, fullKey, channelId, channelScope, status: "active", quota, rateLimitRpm, rateLimitTpm, maxConcurrency, used: 0, createdAt: Date.now(), lastUsedAt: null };
      await pgDb.insert(pgSchema.keys).values(row);
      await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `生成新密钥：${name}`, actor: currentUser.username });
      return NextResponse.json({ ...row, fullKey }, { status: 201 });
    }
    const owner = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!owner) return NextResponse.json({ error: "归属用户不存在" }, { status: 400 });
    const rateLimitRpm = Math.max(0, Number(body.rateLimitRpm) || 0);
    const rateLimitTpm = Math.max(0, Number(body.rateLimitTpm) || 0);
    const maxConcurrency = Math.max(0, Number(body.maxConcurrency) || 0);
    let channelScope = body.channelScope === "claude" || body.channelScope === "openai" ? body.channelScope : "all";
    const channelId = isAdmin(currentUser) && typeof body.channelId === "string" && body.channelId ? body.channelId : null;
    if (channelId) {
      const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
      if (!channel?.enabled) return NextResponse.json({ error: "供应商渠道不存在或已停用" }, { status: 400 });
      channelScope = channel.type;
    }
    const prefix = sk();
    const fullKey = prefix + "-" + nanoid(16);

    const row = {
      id: "k_" + nanoid(8),
      name,
      userId,
      prefix,
      fullKey,
      channelId,
      channelScope,
      status: "active" as const,
      quota,
      rateLimitRpm,
      rateLimitTpm,
      maxConcurrency,
      used: 0,
      createdAt: Date.now(),
      lastUsedAt: null,
    };
    db.insert(schema.keys).values(row).run();
    db.insert(schema.activities).values({
      ts: Date.now(),
      event: `生成新密钥：${name}`,
      actor: currentUser.username,
    }).run();
    // 仅生成瞬间返回 fullKey 一次
    return NextResponse.json({ ...row, fullKey }, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : "未知错误";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "名称已存在" }, { status: 409 });
    }
    return NextResponse.json({ error: "操作失败，请稍后重试" }, { status: 500 });
  }
}

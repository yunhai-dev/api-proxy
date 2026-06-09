import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { AuthError, requireAdmin } from "@/lib/auth";
import { insertDefaultUserQuota, insertDefaultUserQuotaAsync } from "@/lib/user-quota";
import { usePostgres } from "@/lib/db/runtime";
import { pageParams, pageRows, queryText, sortRows } from "@/lib/pagination";

export const dynamic = "force-dynamic";

const roles = new Set(["super_admin", "admin", "user"]);

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { hasPagination, page, pageSize } = pageParams(req.nextUrl);
    const q = queryText(req.nextUrl, "query", "search").toLowerCase();
    const role = req.nextUrl.searchParams.get("role") ?? "all";
    const status = req.nextUrl.searchParams.get("status") ?? "all";
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const rows = await pgDb
        .select({
          id: pgSchema.users.id,
          username: pgSchema.users.username,
          displayName: pgSchema.users.displayName,
          email: pgSchema.users.email,
          role: pgSchema.users.role,
          status: pgSchema.users.status,
          createdAt: pgSchema.users.createdAt,
          updatedAt: pgSchema.users.updatedAt,
          quotaUsd: pgSchema.userQuotas.quotaUsd,
          usedUsd: pgSchema.userQuotas.usedUsd,
        })
        .from(pgSchema.users)
        .leftJoin(pgSchema.userQuotas, eq(pgSchema.userQuotas.userId, pgSchema.users.id));
      const mapped = rows.map(row => ({ ...row, quotaUsd: row.quotaUsd ?? 0, usedUsd: row.usedUsd ?? 0 }));
      const filtered = sortUsers(req.nextUrl, filterUsers(mapped, q, role, status));
      return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered);
    }
    const rows = db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      email: schema.users.email,
      role: schema.users.role,
      status: schema.users.status,
      createdAt: schema.users.createdAt,
      updatedAt: schema.users.updatedAt,
      quotaUsd: schema.userQuotas.quotaUsd,
      usedUsd: schema.userQuotas.usedUsd,
    })
    .from(schema.users)
    .leftJoin(schema.userQuotas, eq(schema.userQuotas.userId, schema.users.id))
    .all();
    const mapped = rows.map(row => ({ ...row, quotaUsd: row.quotaUsd ?? 0, usedUsd: row.usedUsd ?? 0 }));
    const filtered = sortUsers(req.nextUrl, filterUsers(mapped, q, role, status));
    return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function filterUsers<T extends { username: string; displayName: string; email: string; role: string; status: string }>(rows: T[], q: string, role: string, status: string) {
  return rows.filter(row => {
    const matchesQuery = !q || [row.username, row.displayName, row.email].some(value => value.toLowerCase().includes(q));
    const matchesRole = role === "all" || row.role === role;
    const matchesStatus = status === "all" || row.status === status;
    return matchesQuery && matchesRole && matchesStatus;
  });
}

function sortUsers<T extends { username: string; displayName: string; email: string; role: string; status: string; createdAt: number; quotaUsd: number; usedUsd: number }>(url: URL, rows: T[]) {
  return sortRows(url, rows, {
    username: row => row.username,
    displayName: row => row.displayName,
    email: row => row.email,
    balance: row => Math.max(0, row.quotaUsd - row.usedUsd),
    role: row => row.role,
    status: row => row.status,
    createdAt: row => row.createdAt,
  }, "username");
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = roles.has(body.role) ? body.role as "super_admin" | "admin" | "user" : "user";
  if (!username) return NextResponse.json({ error: "请输入用户名" }, { status: 400 });
  if (!displayName) return NextResponse.json({ error: "请输入显示名称" }, { status: 400 });

  const now = Date.now();
  const row = { id: "u_" + nanoid(8), username, displayName, email, role, status: "active" as const, createdAt: now, updatedAt: now };
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      await pgDb.insert(pgSchema.users).values(row);
      await insertDefaultUserQuotaAsync(row.id, now);
      await pgDb.insert(pgSchema.activities).values({ ts: now, event: `创建用户 ${username}`, actor: actor.username });
      return NextResponse.json(row, { status: 201 });
    }
    db.insert(schema.users).values(row).run();
    insertDefaultUserQuota(row.id, now);
    db.insert(schema.activities).values({ ts: now, event: `创建用户 ${username}`, actor: actor.username }).run();
    return NextResponse.json(row, { status: 201 });
  } catch (e: unknown) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "用户名已存在" }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

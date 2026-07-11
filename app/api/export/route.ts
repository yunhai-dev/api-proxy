import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { AuthError, isAdmin, requireUser } from "@/lib/auth";
import { requestedUserId, scopedUserId } from "@/lib/scope";
import { and, eq, inArray, lt } from "drizzle-orm";
import { usePostgres } from "@/lib/db/runtime";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const type = req.nextUrl.searchParams.get("type") || "request_logs";
    const format = req.nextUrl.searchParams.get("format") || "json";
    if (type !== "request_logs" && !isAdmin(user)) return NextResponse.json({ error: "无权导出管理数据" }, { status: 403 });
    const userId = scopedUserId(user, requestedUserId(req.nextUrl));
    const before = parseBefore(req.nextUrl.searchParams.get("before"));
    const rows = await exportRows(type, userId, before);
    if (format === "csv") {
      return new Response(csv(rows), { headers: { "content-type": "text/csv; charset=utf-8" } });
    }
    return NextResponse.json(rows);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

async function exportRows(type: string, userId: string, before: number | null) {
  if (!usePostgres()) {
    const filterBefore = <T extends { ts: number }>(rows: T[]) => before ? rows.filter(row => row.ts < before) : rows;
    return type === "channel_test_logs"
      ? filterBefore(db.select().from(schema.channelTestLogs).all())
      : type === "activities"
        ? filterBefore(db.select().from(schema.activities).all())
        : requestLogRows(userId, before);
  }
  const { pgDb, pgSchema } = await import("@/lib/db/pg");
  if (type === "channel_test_logs") return before
    ? pgDb.select().from(pgSchema.channelTestLogs).where(lt(pgSchema.channelTestLogs.ts, before))
    : pgDb.select().from(pgSchema.channelTestLogs);
  if (type === "activities") return before
    ? pgDb.select().from(pgSchema.activities).where(lt(pgSchema.activities.ts, before))
    : pgDb.select().from(pgSchema.activities);
  const keys = userId ? await pgDb.select({ id: pgSchema.keys.id }).from(pgSchema.keys).where(eq(pgSchema.keys.userId, userId)) : [];
  const keyIds = keys.map(key => key.id);
  if (userId && keyIds.length === 0) return [];
  if (before && userId) return pgDb.select().from(pgSchema.requestLogs).where(and(lt(pgSchema.requestLogs.ts, before), inArray(pgSchema.requestLogs.keyId, keyIds)));
  if (before) return pgDb.select().from(pgSchema.requestLogs).where(lt(pgSchema.requestLogs.ts, before));
  if (userId) return pgDb.select().from(pgSchema.requestLogs).where(inArray(pgSchema.requestLogs.keyId, keyIds));
  return pgDb.select().from(pgSchema.requestLogs);
}

function requestLogRows(userId: string, before: number | null) {
  let rows = db.select().from(schema.requestLogs).all();
  if (before) rows = rows.filter(row => row.ts < before);
  if (!userId) return rows;
  const keys = db.select({ id: schema.keys.id }).from(schema.keys).where(eq(schema.keys.userId, userId)).all();
  const ids = new Set(keys.map(key => key.id));
  return rows.filter(row => ids.has(row.keyId));
}

function parseBefore(value: string | null) {
  if (!value) return null;
  const before = Number(value);
  return Number.isFinite(before) && before > 0 ? before : null;
}

function csv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const lines = [keys.join(",")];
  for (const row of rows) lines.push(keys.map(key => quote(row[key])).join(","));
  return lines.join("\n");
}

function quote(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

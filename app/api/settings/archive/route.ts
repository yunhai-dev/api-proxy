import { NextRequest, NextResponse } from "next/server";
import { count, lt } from "drizzle-orm";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { usePostgres } from "@/lib/db/runtime";

export const dynamic = "force-dynamic";

const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const LABELS: Record<ArchiveType, string> = {
  request_logs: "请求日志",
  channel_test_logs: "渠道测试日志",
  activities: "审计日志",
};

type ArchiveType = "request_logs" | "channel_test_logs" | "activities";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const parsed = parseParams(req.nextUrl.searchParams);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const count = await countRows(parsed.type, parsed.before);
    return NextResponse.json({ type: parsed.type, before: parsed.before, count });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const parsed = parseBody(body);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (body.archiveConfirmed !== true || body.confirm !== "DELETE") return NextResponse.json({ error: "请先下载归档并确认删除" }, { status: 400 });

    const deleted = await deleteRows(parsed.type, parsed.before);
    const now = Date.now();
    const event = `清理${LABELS[parsed.type]} ${deleted} 条，早于 ${new Date(parsed.before).toISOString()}`;
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      await pgDb.insert(pgSchema.activities).values({ ts: now, event, actor: actor.username });
    } else {
      db.insert(schema.activities).values({ ts: now, event, actor: actor.username }).run();
    }
    return NextResponse.json({ ok: true, type: parsed.type, before: parsed.before, deleted });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function parseParams(params: URLSearchParams) {
  return parseTypeBefore(params.get("type"), params.get("before"));
}

function parseBody(body: Record<string, unknown>) {
  return parseTypeBefore(typeof body.type === "string" ? body.type : null, String(body.before ?? ""));
}

function parseTypeBefore(typeValue: string | null, beforeValue: string | null): { type: ArchiveType; before: number } | { error: string } {
  if (typeValue !== "request_logs" && typeValue !== "channel_test_logs" && typeValue !== "activities") return { error: "无效的数据类型" };
  const before = Number(beforeValue);
  if (!Number.isFinite(before) || before <= 0) return { error: "请选择有效的截止时间" };
  if (before > Date.now() - MIN_AGE_MS) return { error: "截止时间至少需要早于当前 24 小时" };
  return { type: typeValue, before };
}

async function countRows(type: ArchiveType, before: number) {
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    if (type === "channel_test_logs") return (await pgDb.select({ count: count() }).from(pgSchema.channelTestLogs).where(lt(pgSchema.channelTestLogs.ts, before)))[0]?.count ?? 0;
    if (type === "activities") return (await pgDb.select({ count: count() }).from(pgSchema.activities).where(lt(pgSchema.activities.ts, before)))[0]?.count ?? 0;
    return (await pgDb.select({ count: count() }).from(pgSchema.requestLogs).where(lt(pgSchema.requestLogs.ts, before)))[0]?.count ?? 0;
  }
  if (type === "channel_test_logs") return db.select({ id: schema.channelTestLogs.id }).from(schema.channelTestLogs).where(lt(schema.channelTestLogs.ts, before)).all().length;
  if (type === "activities") return db.select({ id: schema.activities.id }).from(schema.activities).where(lt(schema.activities.ts, before)).all().length;
  return db.select({ id: schema.requestLogs.id }).from(schema.requestLogs).where(lt(schema.requestLogs.ts, before)).all().length;
}

async function deleteRows(type: ArchiveType, before: number) {
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    if (type === "channel_test_logs") return (await pgDb.delete(pgSchema.channelTestLogs).where(lt(pgSchema.channelTestLogs.ts, before)).returning({ id: pgSchema.channelTestLogs.id })).length;
    if (type === "activities") return (await pgDb.delete(pgSchema.activities).where(lt(pgSchema.activities.ts, before)).returning({ id: pgSchema.activities.id })).length;
    return (await pgDb.delete(pgSchema.requestLogs).where(lt(pgSchema.requestLogs.ts, before)).returning({ id: pgSchema.requestLogs.id })).length;
  }
  const count = await countRows(type, before);
  if (type === "channel_test_logs") db.delete(schema.channelTestLogs).where(lt(schema.channelTestLogs.ts, before)).run();
  else if (type === "activities") db.delete(schema.activities).where(lt(schema.activities.ts, before)).run();
  else db.delete(schema.requestLogs).where(lt(schema.requestLogs.ts, before)).run();
  return count;
}

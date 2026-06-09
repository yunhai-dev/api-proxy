import { NextRequest, NextResponse } from "next/server";
import { getRecentActivityAsync } from "@/lib/stats";
import { AuthError, requireAdmin } from "@/lib/auth";
import { pageParams, pageRows, queryText, sortRows } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { hasPagination, page, pageSize } = pageParams(req.nextUrl);
    const query = queryText(req.nextUrl, "query", "search").toLowerCase();
    const rows = await getRecentActivityAsync(hasPagination ? 1000 : 15);
    const filtered = query ? rows.filter(row => row.event.toLowerCase().includes(query) || row.actor.toLowerCase().includes(query)) : rows;
    const sorted = sortRows(req.nextUrl, filtered, { ts: row => row.ts, event: row => row.event, actor: row => row.actor }, "ts", "desc");
    return NextResponse.json(hasPagination ? pageRows(sorted, page, pageSize) : sorted);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

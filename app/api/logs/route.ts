import { NextRequest, NextResponse } from "next/server";
import { getRecentLogsAsync } from "@/lib/stats";
import { AuthError, isAdmin, requireUser } from "@/lib/auth";
import { requestedUserId, scopedUserId } from "@/lib/scope";
import { pageParams, pageRows, queryText, sortRows } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const admin = isAdmin(user);
    const limit = Math.min(500, Number(req.nextUrl.searchParams.get("limit")) || 200);
    const status = req.nextUrl.searchParams.get("status") ?? "all";
    const userId = scopedUserId(user, requestedUserId(req.nextUrl));
    const { hasPagination, page, pageSize } = pageParams(req.nextUrl);
    const query = queryText(req.nextUrl, "query", "search").toLowerCase();
    const provider = req.nextUrl.searchParams.get("provider") ?? "all";
    const channel = req.nextUrl.searchParams.get("channel") ?? "all";
    const model = req.nextUrl.searchParams.get("model") ?? "all";
    const rows = await getRecentLogsAsync(hasPagination ? 500 : limit, status, { userId });
    const filtered = rows.filter(row => {
      const queryValues = admin ? [row.requestId, row.keyName, row.keyPrefix, row.channelName, row.model, row.inboundModel ?? ""] : [row.requestId, row.keyName, row.keyPrefix, row.channelType, row.model, row.inboundModel ?? ""];
      const matchesQuery = !query || queryValues.some(value => value.toLowerCase().includes(query));
      const matchesProvider = provider === "all" || row.channelType === provider;
      const matchesChannel = !admin || channel === "all" || row.channelName === channel;
      const matchesModel = model === "all" || row.model === model || row.inboundModel === model;
      return matchesQuery && matchesProvider && matchesChannel && matchesModel;
    });
    const sorted = sortRows(req.nextUrl, filtered, {
      ts: row => row.ts,
      status: row => row.status,
      keyName: row => row.keyName,
      channelName: row => admin ? row.channelName : row.channelType,
      model: row => row.model,
      tokensIn: row => row.tokensIn,
      tokensOut: row => row.tokensOut,
      cacheReadTokens: row => row.cacheReadTokens,
      cacheCreationTokens: row => row.cacheCreationTokens,
      tokens: row => row.tokensIn + row.tokensOut + row.cacheReadTokens + row.cacheCreationTokens,
      cost: row => row.cost,
      latencyMs: row => row.latencyMs,
    }, "ts", "desc");
    const output = admin ? sorted : sorted.map(row => ({ ...row, channelName: row.channelType }));
    return NextResponse.json(hasPagination ? pageRows(output, page, pageSize) : output);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

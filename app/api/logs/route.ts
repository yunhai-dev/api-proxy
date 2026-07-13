import { NextRequest, NextResponse } from "next/server";
import { getRecentLogsAsync } from "@/lib/stats";
import { AuthError, isAdmin, requireUser } from "@/lib/auth";
import { requestedUserId, scopedUserId } from "@/lib/scope";
import { pageParams, pageRows, queryText, sortRows } from "@/lib/pagination";
import type { LogListEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

function userLogEntry(row: LogListEntry) {
  const model = row.inboundModel || row.model;
  return {
    id: row.id,
    requestId: row.requestId,
    ts: row.ts,
    keyId: row.keyId,
    keyName: row.keyName,
    keyPrefix: row.keyPrefix,
    channelId: row.channelId,
    channelName: row.channelType,
    channelType: row.channelType,
    model,
    inboundModel: model,
    status: row.status,
    latencyMs: row.latencyMs,
    ttftMs: row.ttftMs,
    durationMs: row.durationMs,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    cacheTokens: row.cacheTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    hasDetail: row.hasDetail,
    reasoningEffort: row.reasoningEffort,
    cost: row.cost,
  };
}

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
      const displayModel = row.inboundModel || row.model;
      const queryValues = admin ? [row.requestId, row.keyName, row.keyPrefix, row.channelName, row.userName ?? "", row.username ?? "", row.model, row.inboundModel ?? "", row.upstreamModel ?? ""] : [row.requestId, row.keyName, row.keyPrefix, row.channelType, displayModel];
      const matchesQuery = !query || queryValues.some(value => value.toLowerCase().includes(query));
      const matchesProvider = provider === "all" || row.channelType === provider;
      const matchesChannel = !admin || channel === "all" || row.channelName === channel;
      const matchesModel = model === "all" || (admin ? row.model === model || row.inboundModel === model || row.upstreamModel === model : displayModel === model);
      return matchesQuery && matchesProvider && matchesChannel && matchesModel;
    });
    const sorted = sortRows(req.nextUrl, filtered, {
      ts: row => row.ts,
      status: row => row.status,
      keyName: row => row.keyName,
      userName: row => admin ? row.userName || row.username : "",
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
    if (hasPagination) {
      if (admin) return NextResponse.json(pageRows(sorted, page, pageSize));
      return NextResponse.json(pageRows(sorted.map(userLogEntry), page, pageSize));
    }
    return NextResponse.json(admin ? sorted : sorted.map(userLogEntry));
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

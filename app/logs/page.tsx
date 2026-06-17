import { PageHead } from "@/components/page-head";
import { getRecentLogsAsync } from "@/lib/stats";
import { LogStream } from "@/components/logs/log-stream";
import { requireUser } from "@/lib/auth";
import type { LogListEntry } from "@/lib/types";

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
    cost: row.cost,
  };
}

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const user = await requireUser();
  const initial = (await getRecentLogsAsync(50, "all", { userId: user.id })).map(userLogEntry);
  return (
    <div className="container data-container">
      <PageHead
        title="请求日志"
        sub={
          <>
            <span>接收中…</span>
            <span className="sep">/</span>
            <span className="mono dim">最多显示 200 条</span>
          </>
        }
      />
      <LogStream initial={initial} />
    </div>
  );
}

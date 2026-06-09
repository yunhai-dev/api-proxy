import { PageHead } from "@/components/page-head";
import { getRecentLogsAsync } from "@/lib/stats";
import { LogStream } from "@/components/logs/log-stream";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const user = await requireUser();
  const initial = (await getRecentLogsAsync(50, "all", { userId: user.id })).map(row => ({ ...row, channelName: row.channelType }));
  return (
    <div className="container">
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

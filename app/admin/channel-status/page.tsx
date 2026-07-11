import { PageHead } from "@/components/page-head";
import { ChannelStatusClient } from "@/components/channels/channel-status-client";
import { requireAdmin } from "@/lib/auth";
import { loadChannelHealth } from "./actions";

export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_LABEL = "1 小时";

export default async function ChannelStatusPage() {
  await requireAdmin();
  const now = Date.now();
  const since = now - HOUR_MS;
  const until = now;
  const initialRows = await loadChannelHealth({ since, until });

  return (
    <div className="container data-container">
      <PageHead title="状态" sub={<><span>健康检查</span><span className="sep">/</span><span>近 1 小时</span></>} />
      <ChannelStatusClient initialRows={initialRows} since={since} until={until} windowMs={HOUR_MS} windowLabel={WINDOW_LABEL} loadHealth={loadChannelHealth} />
    </div>
  );
}


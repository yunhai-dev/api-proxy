import { PageHead } from "@/components/page-head";
import { ChannelStatusClient } from "@/components/channels/channel-status-client";
import { requireAdmin } from "@/lib/auth";
import { loadChannelHealth } from "./actions";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

export default async function ChannelStatusPage() {
  await requireAdmin();
  const now = Date.now();
  const since = now - WINDOW_DAYS * DAY_MS;
  const until = now;
  const initialRows = await loadChannelHealth({ since, until });

  return (
    <div className="container data-container">
      <PageHead title="状态" sub={<><span>健康检查</span><span className="sep">/</span><span>30 天窗口</span></>} />
      <ChannelStatusClient initialRows={initialRows} since={since} until={until} windowDays={WINDOW_DAYS} loadHealth={loadChannelHealth} />
    </div>
  );
}


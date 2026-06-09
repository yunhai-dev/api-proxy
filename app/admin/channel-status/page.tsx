import { PageHead } from "@/components/page-head";
import { RangeForm } from "@/components/dashboard/range-form";
import { ChannelHealthList } from "@/components/channels/channel-health-list";
import { getChannelHealthAsync } from "@/lib/stats";
import { requireAdmin } from "@/lib/auth";
import type { DashboardRange } from "@/lib/types";

export const dynamic = "force-dynamic";

function toDateTimeLocal(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDateTimeLocal(v: string | undefined) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function rangeSince(range: DashboardRange, now: number) {
  if (range === "today") { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  return now - 24 * 60 * 60 * 1000;
}

export default async function ChannelStatusPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const now = Date.now();
  const parsedFrom = parseDateTimeLocal(sp.from);
  const parsedTo = parseDateTimeLocal(sp.to);
  const canUseCustom = sp.range === "custom" && parsedFrom !== null && parsedTo !== null && parsedTo > parsedFrom;
  const range = (canUseCustom ? "custom" : (sp.range === "today" || sp.range === "7d" || sp.range === "24h" ? sp.range : "24h")) as DashboardRange;
  const since = canUseCustom ? parsedFrom : rangeSince(range, now);
  const until = canUseCustom ? parsedTo : now;
  const health = await getChannelHealthAsync({ since, until });

  return (
    <div className="container data-container">
      <PageHead
        title="状态"
        sub={
          <>
            <span>健康检查</span>
            <span className="sep">/</span>
            <span>{health.length} 个定时检查渠道</span>
          </>
        }
      />
      <RangeForm action="/admin/channel-status" from={toDateTimeLocal(since)} to={toDateTimeLocal(until)} />
      <section className="section" style={{ marginTop: 24 }}>
        <ChannelHealthList rows={health} />
      </section>
    </div>
  );
}

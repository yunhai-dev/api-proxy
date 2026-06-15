import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserDetailAsync } from "@/lib/user-stats";
import { UserTokenChart } from "@/components/users/user-token-chart";
import { UserDetailTables } from "@/components/users/user-detail-tables";
import { RangeForm } from "@/components/dashboard/range-form";
import type { DashboardRange } from "@/lib/types";
import { requireAdmin } from "@/lib/auth";
import { parseShanghaiDateTimeLocal, startOfShanghaiDay, toShanghaiDateTimeLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

function rangeSince(range: DashboardRange, now: number) {
  if (range === "today") return startOfShanghaiDay(now);
  if (range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  return now - 24 * 60 * 60 * 1000;
}

export default async function UserDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const now = Date.now();
  const parsedFrom = parseShanghaiDateTimeLocal(sp.from);
  const parsedTo = parseShanghaiDateTimeLocal(sp.to);
  const canUseCustom = sp.range === "custom" && parsedFrom !== null && parsedTo !== null && parsedTo > parsedFrom;
  const range = (canUseCustom ? "custom" : (sp.range === "today" || sp.range === "7d" || sp.range === "24h" ? sp.range : "24h")) as DashboardRange;
  const since = canUseCustom ? parsedFrom : rangeSince(range, now);
  const until = canUseCustom ? parsedTo : now;
  const data = await getUserDetailAsync(id, { since, until });
  if (!data) notFound();
  const { user, quota, keys, stats } = data;
  return (
    <section>
      <div className="section-title">
        <h1>{user.displayName}</h1>
        <p className="mono">{user.username} · {user.email || "无邮箱"}</p>
      </div>
      <div className="page-actions"><Link className="btn" href="/users">返回用户列表</Link></div>
      <RangeForm action={`/users/${id}`} from={toShanghaiDateTimeLocal(since)} to={toShanghaiDateTimeLocal(until)} />

      <div className="stat-strip">
        <Stat label="请求量" value={stats.requests.toLocaleString()} />
        <Stat label="成功率" value={`${stats.successRate.toFixed(1)}%`} />
        <Stat label="消费" value={`$${stats.cost.toFixed(4)}`} />
        <Stat label="额度" value={`$${(quota?.quotaUsd ?? 0).toFixed(2)}`} extra={`已用 $${(quota?.usedUsd ?? 0).toFixed(4)}`} />
        <Stat label="Token" value={(stats.tokensIn + stats.tokensOut + stats.cacheReadTokens + stats.cacheCreationTokens).toLocaleString()} />
      </div>

      <section className="section">
        <h2>Token 消耗趋势</h2>
        <UserTokenChart data={stats.tokenSeries} />
      </section>

      <UserDetailTables keys={keys} models={stats.models} recentLogs={stats.recentLogs} />
    </section>
  );
}

function Stat({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return <div className="stat"><div className="label">{label}</div><div className="value">{value}</div>{extra && <div className="extra">{extra}</div>}</div>;
}

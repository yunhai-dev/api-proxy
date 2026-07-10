import { PageHead } from "@/components/page-head";
import { ChannelTrafficChart } from "@/components/dashboard/channel-traffic-chart";
import { ModelUsageBarChart } from "@/components/dashboard/model-usage-bar-chart";
import { RangeForm } from "@/components/dashboard/range-form";
import { ThroughputChart } from "@/components/dashboard/throughput-chart";
import { UserTokenTrendChart } from "@/components/dashboard/user-token-trend-chart";
import { requireAdmin } from "@/lib/auth";
import { getDashboardStatsAsync } from "@/lib/stats";
import type { DashboardRange } from "@/lib/types";
import { formatShanghaiDateTime, parseShanghaiDateTimeLocal, toShanghaiDateTimeLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const now = Date.now();
  const parsedFrom = parseShanghaiDateTimeLocal(sp.from);
  const parsedTo = parseShanghaiDateTimeLocal(sp.to);
  const canUseCustom = sp.range === "custom" && parsedFrom !== null && parsedTo !== null && parsedTo > parsedFrom;
  const range = (canUseCustom ? "custom" : (sp.range === "today" || sp.range === "7d" || sp.range === "24h" ? sp.range : "24h")) as DashboardRange;
  const customFrom = canUseCustom ? parsedFrom : now - 24 * 60 * 60 * 1000;
  const customTo = canUseCustom ? parsedTo : now;
  const stats = range === "custom" ? await getDashboardStatsAsync({ since: customFrom, until: customTo }) : await getDashboardStatsAsync(range);
  return (
    <div className="container data-container">
      <PageHead
        title="管理总览"
        sub={
          <>
            <span>全局流量概览</span>
            <span className="sep">/</span>
            <span className="mono dim">最近 24 小时</span>
          </>
        }
      />
      <RangeForm action="/admin/dashboard" from={toShanghaiDateTimeLocal(customFrom)} to={toShanghaiDateTimeLocal(customTo)} />

      <div className="stat-strip">
        <Stat label="请求量" value={fmtNum(stats.requests24h)} extra={`较前一区间 ${signed(stats.requestsDelta)}%`} />
        <Stat label="进行中" value={fmtNum(stats.activeConversations)} extra="当前未完成请求" />
        <Stat label="成功率" value={`${stats.successRate.toFixed(1)}%`} extra="2xx / 总请求" />
        <Stat label="P50 延迟" value={`${stats.p50}ms`} extra="成功请求中位数" />
        <Stat label="Token" value={fmtTokenValue(stats.tokensIn + stats.tokensOut + stats.cacheReadTokens + stats.cacheCreationTokens)} extra={`输入 ${fmtTokenValue(stats.tokensIn)} · 输出 ${fmtTokenValue(stats.tokensOut)}`} />
        <Stat label="缓存命中率" value={`${stats.cacheHit.toFixed(1)}%`} extra={`命中 ${fmtTokenValue(stats.cacheReadTokens)} · 创建 ${fmtTokenValue(stats.cacheCreationTokens)}`} />
        <Stat label="费用" value={`$${stats.cost.toFixed(2)}`} extra="按模型定价计算" />
      </div>

      <ThroughputChart series={stats.throughputSeries} />

      <UserTokenTrendChart users={stats.userTokenUsers} data={stats.userTokenSeries} />

      <section className="section perf-section">
        <div className="section-head-inline"><h2>全局性能</h2><span className="mono dim">TTFT / Duration</span></div>
        <div className="perf-grid">
          <Perf label="QPS" value={stats.globalPerf.qps} digits={3} />
          <Perf label="TPS" value={stats.globalPerf.tps} digits={1} />
          <Perf label="TTFT Avg" value={stats.globalPerf.ttftAvgMs} unit="ms" />
          <Perf label="TTFT P95" value={stats.globalPerf.ttftP95Ms} unit="ms" />
          <Perf label="Duration Avg" value={stats.globalPerf.durationAvgMs} unit="ms" />
          <Perf label="Duration P95" value={stats.globalPerf.durationP95Ms} unit="ms" />
        </div>
      </section>

      <section className="section section-stack">
        <div className="section-head-inline"><h2>渠道流量</h2><span className="mono dim">按请求量占比</span></div>
        <ChannelTrafficChart data={stats.trafficByChannel} />
      </section>

      <section className="section section-stack">
        <h2>用户消耗榜</h2>
        <div className="table-wrap">
        <table className="table">
          <thead><tr><th>用户</th><th>用户名</th><th>请求</th><th>Token</th><th>费用</th><th>最后使用</th></tr></thead>
          <tbody>
            {stats.topUsers.length === 0 && <tr><td colSpan={6} className="empty">暂无用户使用数据 <span className="mono dim">// no rows</span></td></tr>}
            {stats.topUsers.map(u => <tr key={u.id}><td>{u.name}</td><td className="mono dim">{u.username}</td><td className="mono">{u.requests.toLocaleString()}</td><td className="mono">{fmtTokenValue(u.totalTokens / 1_000_000)}</td><td className="mono">${u.cost.toFixed(4)}</td><td className="mono dim">{u.last ? formatShanghaiDateTime(u.last) : "—"}</td></tr>)}
          </tbody>
        </table>
        </div>
      </section>

      <section className="section section-stack">
        <h2>模型消耗排行</h2>
        <ModelUsageBarChart rows={stats.modelStats} />
        <div className="table-wrap">
        <table className="table model-stats-table">
          <thead><tr><th>模型</th><th>服务商</th><th>请求</th><th>Token</th><th>输入</th><th>输出</th><th>费用</th></tr></thead>
          <tbody>
            {stats.modelStats.length === 0 && <tr><td colSpan={7} className="empty">暂无模型使用数据 <span className="mono dim">// no rows</span></td></tr>}
            {stats.modelStats.map(m => <tr key={`${m.provider}:${m.model}`}><td className="mono">{m.model}</td><td><span className={`type-pill ${m.provider}`}>{m.provider === "claude" ? "Claude" : "OpenAI"}</span></td><td className="mono">{m.requests.toLocaleString()}</td><td className="mono">{fmtTokenValue(m.totalTokens / 1_000_000)}</td><td className="mono dim">{fmtTokenValue(m.tokensIn / 1_000_000)}</td><td className="mono dim">{fmtTokenValue(m.tokensOut / 1_000_000)}</td><td className="mono">${m.cost.toFixed(4)}</td></tr>)}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return <div className="stat"><div className="label">{label}</div><div className="value">{value}</div>{extra && <div className="meta">{extra}</div>}</div>;
}

function Perf({ label, value, unit, digits = 0 }: { label: string; value: number; unit?: string; digits?: number }) {
  const text = digits > 0 ? value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "") : Math.round(value).toLocaleString();
  return <div className="perf-card"><div className="label">{label}</div><div className="value">{text}{unit && <span>{unit}</span>}</div><div className="hint">global</div></div>;
}

function signed(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}`;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

function trimNumber(value: number, digits: number) {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function fmtTokenValue(millions: number) {
  const tokens = millions * 1_000_000;
  if (tokens <= 0) return "0";
  if (tokens < 1_000) return Math.round(tokens).toLocaleString();
  if (tokens < 1_000_000) return `${trimNumber(tokens / 1_000, tokens < 10_000 ? 2 : 1)}K`;
  if (tokens < 1_000_000_000) return `${trimNumber(tokens / 1_000_000, tokens < 10_000_000 ? 2 : 1)}M`;
  return `${trimNumber(tokens / 1_000_000_000, tokens < 10_000_000_000 ? 2 : 1)}B`;
}

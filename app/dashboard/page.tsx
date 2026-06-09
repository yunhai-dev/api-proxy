import Link from "next/link";
import { PageHead } from "@/components/page-head";
import { RangeForm } from "@/components/dashboard/range-form";
import { RedeemGiftCardModal } from "@/components/gift-cards/redeem-gift-card-modal";
import { UserTokenChart } from "@/components/users/user-token-chart";
import { getDashboardStatsAsync } from "@/lib/stats";
import { getUserDetailAsync } from "@/lib/user-stats";
import type { DashboardRange } from "@/lib/types";
import { requireUser } from "@/lib/auth";

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

function fmtUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = Date.now();
  const parsedFrom = parseDateTimeLocal(sp.from);
  const parsedTo = parseDateTimeLocal(sp.to);
  const canUseCustom = sp.range === "custom" && parsedFrom !== null && parsedTo !== null && parsedTo > parsedFrom;
  const range = (canUseCustom ? "custom" : (sp.range === "today" || sp.range === "7d" || sp.range === "24h" ? sp.range : "24h")) as DashboardRange;
  const customFrom = canUseCustom ? parsedFrom : now - 24 * 60 * 60 * 1000;
  const customTo = canUseCustom ? parsedTo : now;
  const stats = range === "custom" ? await getDashboardStatsAsync({ since: customFrom, until: customTo }, { userId: user.id }) : await getDashboardStatsAsync(range, { userId: user.id });
  const detail = await getUserDetailAsync(user.id, { since: customFrom, until: customTo });
  const quotaUsd = detail?.quota?.quotaUsd ?? 0;
  const usedUsd = detail?.quota?.usedUsd ?? 0;
  const balanceUsd = Math.max(0, quotaUsd - usedUsd);
  const usageByKey = new Map(stats.topKeys.map(k => [k.id, k]));
  const keyRows = (detail?.keys.length
    ? detail.keys.map(k => {
      const usage = usageByKey.get(k.id);
      return {
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        requests: usage?.requests ?? k.periodStats.requests,
        tokens: usage?.totalTokens ?? k.periodStats.tokens,
        cost: usage?.cost ?? k.periodStats.cost,
        last: usage?.last ?? k.lastUsedAt ?? 0,
      };
    })
    : stats.topKeys.map(k => ({ id: k.id, name: k.name, prefix: k.prefix, requests: k.requests, tokens: k.totalTokens, cost: k.cost, last: k.last })))
    .sort((a, b) => b.tokens - a.tokens);

  return (
    <>
      <div className="container data-container">
        <PageHead
          title="我的状态"
          sub={
            <>
              <span>{user.displayName || user.username}</span>
              <span className="sep">/</span>
              <span>个人 API 使用概览</span>
            </>
          }
          actions={
            <>
              <Link href="/keys" className="btn">
                管理密钥 <span className="mono kbd">K</span>
              </Link>
              <RedeemGiftCardModal />
              <Link href="/logs" className="btn">
                查看日志 <span className="mono kbd">L</span>
              </Link>
            </>
          }
        />

        <RangeForm from={toDateTimeLocal(customFrom)} to={toDateTimeLocal(customTo)} />

        <div className="stat-strip">
          <Stat
            label="请求量"
            value={fmtNum(stats.requests24h)}
            delta={stats.requestsDelta}
            deltaSuffix="较昨天"
          />
          <Stat
            label="进行中"
            value={fmtNum(stats.activeConversations)}
            extra={<span>当前未完成请求</span>}
          />
          <Stat
            label="余额"
            value={fmtUsd(balanceUsd)}
            extra={<span>已用 {fmtUsd(usedUsd)}</span>}
          />
          <Stat
            label="成功率"
            value={stats.successRate.toFixed(1)}
            unit="%"
            delta={stats.successDelta}
            deltaSuffix="14:02 出现 429"
            downIsGood
          />
          <Stat
            label="P50 延迟"
            value={String(stats.p50)}
            unit="ms"
            delta={stats.p50Delta}
            deltaSuffix="渠道 2 已预热"
            downIsGood
          />
          <Stat
            label="Token"
            value={fmtTokenValue(stats.tokensIn + stats.tokensOut + stats.cacheReadTokens + stats.cacheCreationTokens)}
            extra={
              <>
                <span>输入 {fmtTokenValue(stats.tokensIn)}</span>
                <span className="dim">·</span>
                <span>输出 {fmtTokenValue(stats.tokensOut)}</span>
              </>
            }
          />
          <Stat
            label="缓存命中率"
            value={stats.cacheHit.toFixed(1)}
            unit="%"
            extra={<span>命中 {stats.cacheReadTokens.toFixed(2)}M · 创建 {stats.cacheCreationTokens.toFixed(2)}M</span>}
          />
          <Stat
            label="费用"
            value={`$${Math.floor(stats.cost)}`}
            smallValue={stats.cost.toFixed(2).split(".")[1]}
            extra={<span>按模型定价计算</span>}
          />
        </div>

        <section className="section throughput-section">
          <h2>Token 消耗趋势</h2>
          <UserTokenChart data={detail?.stats.tokenSeries ?? []} />
        </section>

        <section className="section" style={{ marginTop: 32 }}>
          <h2>我的 API Key 消耗</h2>
          <div className="table-wrap">
          <table className="table">
            <thead><tr><th>名称</th><th>前缀</th><th>请求</th><th>Token</th><th>费用</th><th>最后使用</th></tr></thead>
            <tbody>
              {keyRows.length === 0 && <tr><td colSpan={6} className="empty">暂无绑定 Key</td></tr>}
              {keyRows.map(k => <tr key={k.id}><td>{k.name}</td><td className="mono dim">{k.prefix}</td><td className="mono">{k.requests.toLocaleString()}</td><td className="mono">{fmtTokenValue(k.tokens / 1_000_000)}</td><td className="mono">${k.cost.toFixed(4)}</td><td className="mono dim">{k.last ? new Date(k.last).toLocaleString() : "—"}</td></tr>)}
            </tbody>
          </table>
          </div>
        </section>

        <section className="section" style={{ marginTop: 32 }}>
          <h2>我的模型消耗</h2>
          <table className="table model-stats-table">
            <thead><tr><th>模型</th><th>请求</th><th>Token</th><th>输入</th><th>输出</th><th>费用</th></tr></thead>
            <tbody>
              {stats.modelStats.length === 0 && <tr><td colSpan={6} className="empty">暂无模型使用数据</td></tr>}
              {stats.modelStats.map(m => <tr key={`${m.provider}:${m.model}`}><td className="mono">{m.model}</td><td className="mono">{m.requests.toLocaleString()}</td><td className="mono">{fmtTokenValue(m.totalTokens / 1_000_000)}</td><td className="mono dim">{fmtTokenValue(m.tokensIn / 1_000_000)}</td><td className="mono dim">{fmtTokenValue(m.tokensOut / 1_000_000)}</td><td className="mono">${m.cost.toFixed(4)}</td></tr>)}
            </tbody>
          </table>
        </section>

      </div>
    </>
  );
}

function Stat({
  label, value, unit, smallValue, delta, deltaSuffix, downIsGood, extra,
}: {
  label: string;
  value: string;
  unit?: string;
  smallValue?: string;
  delta?: number;
  deltaSuffix?: string;
  downIsGood?: boolean;
  extra?: React.ReactNode;
}) {
  const sign = delta !== undefined && delta >= 0 ? "+" : "";
  const deltaCls = delta === undefined
    ? ""
    : (delta >= 0) === !downIsGood ? "delta-up" : "delta-down";
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">
        {value}
        {smallValue && <span style={{ color: "var(--text-3)", fontSize: 18 }}>.{smallValue}</span>}
        {unit && <span style={{ color: "var(--text-3)", fontSize: 14 }}>{unit}</span>}
      </div>
      {delta !== undefined ? (
        <div className="meta">
          <span className={`${deltaCls} mono`}>{sign}{delta.toFixed(1)}%</span>
          {deltaSuffix && <span>{deltaSuffix}</span>}
        </div>
      ) : extra ? (
        <div className="meta">{extra}</div>
      ) : null}
    </div>
  );
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

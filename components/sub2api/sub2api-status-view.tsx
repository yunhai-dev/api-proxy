"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ListPagination } from "@/components/ui/list-pagination";
import { Select } from "@/components/ui/select";
import { formatShanghaiDateTime } from "@/lib/time";

type Account = {
  id: number; name: string; platform: string; type: string; status: string; schedulable: boolean;
  concurrency: number; currentConcurrency: number; priority: number; rateMultiplier: number;
  groups: { id: number; name: string; platform: string }[]; rateLimitedAt: number | string | null;
  rateLimitResetAt: number | string | null; overloadUntil: number | string | null; tempUnschedulableReason: string;
  tempUnschedulableUntil: number | string | null; expiresAt: number | string | null; lastUsedAt: number | string | null; updatedAt: number | string | null;
};
type AccountDetail = Account & { errorMessage: string; quotaDimension: string; sessionWindowStatus: string; sessionWindowStart: number | string | null; sessionWindowEnd: number | string | null };
type Status = {
  health: { total: number; schedulable: number; unschedulable: number; normal: number; error: number; rateLimited: number; expired: number; currentConcurrency: number; maxConcurrency: number };
  groups: { groupId: number; name: string; concurrencyUsed: number; concurrencyMax: number; sessionsUsed: number; sessionsMax: number; rpmUsed: number; rpmMax: number }[];
  platforms: { platform: string; total: number; schedulable: number; error: number; currentConcurrency: number; maxConcurrency: number }[];
  today: { requests: number; inputTokens: number; outputTokens: number; cacheTokens: number; totalTokens: number; cost: number; actualCost: number; rpm: number; tpm: number };
  updatedAt: number;
};
type AccountsPage = { items: Account[]; total: number; page: number; pageSize: number; pages: number; updatedAt: number };

export function Sub2ApiStatusView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [accounts, setAccounts] = useState<AccountsPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [platform, setPlatform] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const refreshRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    const seq = ++refreshRef.current;
    if (!silent) setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (platform) params.set("platform", platform);
    if (accountStatus) params.set("status", accountStatus);
    if (query) params.set("search", query);
    try {
      const [statusResponse, accountsResponse] = await Promise.all([
        fetch("/api/sub2api/status", { cache: "no-store" }),
        fetch(`/api/sub2api/accounts?${params}`, { cache: "no-store" }),
      ]);
      const [statusData, accountsData] = await Promise.all([statusResponse.json().catch(() => ({})), accountsResponse.json().catch(() => ({}))]);
      if (!statusResponse.ok || !accountsResponse.ok) throw new Error(statusData.error || accountsData.error || "加载失败");
      if (seq !== refreshRef.current) return;
      setStatus(statusData);
      setAccounts(accountsData);
      setError("");
    } catch (reason) {
      if (seq === refreshRef.current) setError(reason instanceof Error ? reason.message : "加载失败");
    } finally {
      if (seq === refreshRef.current) setLoading(false);
    }
  }, [page, pageSize, platform, accountStatus, query]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load(true); }, 30_000);
    const visible = () => { if (!document.hidden) void load(true); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load]);

  async function openDetail(id: number) {
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await fetch(`/api/sub2api/accounts?id=${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "详情加载失败");
      setDetail(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "详情加载失败");
    } finally { setDetailLoading(false); }
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  const platforms = status?.platforms.map(row => row.platform) ?? [];
  const updatedAt = Math.max(status?.updatedAt ?? 0, accounts?.updatedAt ?? 0);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{updatedAt ? `最近更新 ${formatShanghaiDateTime(updatedAt)}` : "每 30 秒自动刷新"}</span>
        <button className="btn" onClick={() => void load()} disabled={loading}>{loading ? "刷新中…" : "刷新"}</button>
      </div>
      {error && <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><span>{error}</span> <button className="ml-2 underline" onClick={() => void load()}>重试</button></div>}
      {status ? <Summary status={status} /> : loading && <div className="empty"><span className="loading-spinner" aria-label="加载中" /></div>}

      <section className="section">
        <h2>账号状态</h2>
        <form className="filters" onSubmit={submitSearch}>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索账号" aria-label="搜索账号" />
          <Select value={platform || "__all"} onChange={value => { setPlatform(value === "__all" ? "" : value); setPage(1); }} options={[{ value: "__all", label: "全部平台" }, ...platforms.map(value => ({ value, label: value }))]} />
          <Select value={accountStatus || "__all"} onChange={value => { setAccountStatus(value === "__all" ? "" : value); setPage(1); }} options={[{ value: "__all", label: "全部状态" }, { value: "active", label: "active" }, { value: "error", label: "error" }, { value: "disabled", label: "disabled" }]} />
          <button className="btn" type="submit">搜索</button>
        </form>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>账号</th><th>平台 / 类型</th><th>状态</th><th>并发</th><th>分组</th><th>最近使用</th><th /></tr></thead>
            <tbody>
              {!loading && accounts?.items.length === 0 && <tr><td colSpan={7} className="empty">暂无账号</td></tr>}
              {accounts?.items.map(account => <AccountRow key={account.id} account={account} onDetail={() => void openDetail(account.id)} />)}
            </tbody>
          </table>
        </div>
        <ListPagination page={page} pageSize={pageSize} total={accounts?.total ?? 0} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </section>
      {(detailLoading || detail) && <DetailModal detail={detail} loading={detailLoading} onClose={() => { setDetail(null); setDetailLoading(false); }} />}
    </>
  );
}

function Summary({ status }: { status: Status }) {
  const { health, today } = status;
  return (
    <>
      <div className="stat-strip">
        <Stat label="账号" value={health.total.toLocaleString()} extra={`可调度 ${health.schedulable} / 异常 ${health.error}`} />
        <Stat label="限流 / 过期" value={`${health.rateLimited} / ${health.expired}`} />
        <Stat label="并发" value={`${health.currentConcurrency} / ${health.maxConcurrency}`} />
        <Stat label="今日请求" value={today.requests.toLocaleString()} extra={`RPM ${today.rpm.toLocaleString()}`} />
        <Stat label="今日 Token" value={today.totalTokens.toLocaleString()} extra={`TPM ${today.tpm.toLocaleString()}`} />
        <Stat label="今日费用" value={`$${today.actualCost.toFixed(2)}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SummaryTable title="分组容量" headers={["分组", "并发", "会话", "RPM"]} rows={status.groups.map(row => [row.name, ratio(row.concurrencyUsed, row.concurrencyMax), ratio(row.sessionsUsed, row.sessionsMax), ratio(row.rpmUsed, row.rpmMax)])} />
        <SummaryTable title="平台状态" headers={["平台", "账号", "可调度", "异常", "并发"]} rows={status.platforms.map(row => [row.platform, row.total, row.schedulable, row.error, ratio(row.currentConcurrency, row.maxConcurrency)])} />
      </div>
    </>
  );
}

function SummaryTable({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number)[][] }) {
  return <section className="section"><h2>{title}</h2><div className="table-wrap"><table className="table"><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className={cellIndex ? "mono" : ""}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length} className="empty">暂无数据</td></tr>}</tbody></table></div></section>;
}

function AccountRow({ account, onDetail }: { account: Account; onDetail: () => void }) {
  const state = account.status === "active" && account.schedulable ? "ok" : account.status === "active" ? "warn" : "err";
  const label = state === "ok" ? "正常" : state === "warn" ? "不可调度" : account.status || "异常";
  return <tr><td><strong>{account.name || `#${account.id}`}</strong><div className="mono dim">#{account.id}</div></td><td><span className="mono">{account.platform}</span><div className="dim">{account.type}</div></td><td><span className={`status-badge ${state}`}><span className="dot" />{label}</span>{account.tempUnschedulableReason && <div className="dim">{account.tempUnschedulableReason}</div>}</td><td className="mono">{account.currentConcurrency} / {account.concurrency}</td><td>{account.groups.map(group => group.name).join(", ") || "—"}</td><td className="mono">{formatTime(account.lastUsedAt)}</td><td><button className="btn sm ghost" onClick={onDetail}>详情</button></td></tr>;
}

function DetailModal({ detail, loading, onClose }: { detail: AccountDetail | null; loading: boolean; onClose: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-head"><h2>账号状态详情</h2><button className="modal-close" onClick={onClose} aria-label="关闭">×</button></div><div className="modal-body">{loading || !detail ? <div className="empty"><span className="loading-spinner" aria-label="加载中" /></div> : <div className="table-wrap"><table className="table"><tbody>{[
    ["账号", `${detail.name} (#${detail.id})`], ["平台 / 类型", `${detail.platform} / ${detail.type}`], ["状态", `${detail.status} / ${detail.schedulable ? "可调度" : "不可调度"}`], ["并发", ratio(detail.currentConcurrency, detail.concurrency)], ["分组", detail.groups.map(group => group.name).join(", ") || "—"], ["倍率", detail.rateMultiplier], ["优先级", detail.priority], ["限流重置", formatTime(detail.rateLimitResetAt)], ["临时不可调度至", formatTime(detail.tempUnschedulableUntil)], ["过期时间", formatTime(detail.expiresAt)], ["会话窗口", detail.sessionWindowStatus || "—"], ["最近错误", detail.errorMessage || "—"],
  ].map(([label, value]) => <tr key={String(label)}><th>{label}</th><td className="mono">{value}</td></tr>)}</tbody></table></div>}</div><div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div></div></div>;
}

function Stat({ label, value, extra }: { label: string; value: string; extra?: string }) { return <div className="stat"><div className="label">{label}</div><div className="value">{value}</div>{extra && <div className="extra">{extra}</div>}</div>; }
function ratio(value: number, max: number) { return max > 0 ? `${value.toLocaleString()} / ${max.toLocaleString()}` : `${value.toLocaleString()} / —`; }
function formatTime(value: number | string | null) { if (value === null || value === "") return "—"; const raw = typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value; const timestamp = typeof raw === "number" ? raw : Date.parse(raw); return Number.isFinite(timestamp) ? formatShanghaiDateTime(timestamp) : "—"; }

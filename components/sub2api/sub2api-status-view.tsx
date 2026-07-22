"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { Select } from "@/components/ui/select";
import { formatShanghaiDateTime } from "@/lib/time";
import type { Sub2ApiAccount as Account, Sub2ApiAccountDetail as AccountDetail, Sub2ApiPage, Sub2ApiStatus as Status } from "@/lib/sub2api";

type AccountsPage = Sub2ApiPage<Account> & { updatedAt: number };

export function Sub2ApiStatusView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [accounts, setAccounts] = useState<AccountsPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [platform, setPlatform] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [statusError, setStatusError] = useState("");
  const [accountsError, setAccountsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const accountsSeq = useRef(0);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sub2api/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "状态加载失败");
      setStatus(data);
      setStatusError("");
    } catch (reason) {
      setStatusError(reason instanceof Error ? reason.message : "状态加载失败");
    }
  }, []);

  const loadAccounts = useCallback(async (silent = false) => {
    const seq = ++accountsSeq.current;
    if (!silent) setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (platform) params.set("platform", platform);
    if (accountStatus) params.set("status", accountStatus);
    if (query) params.set("search", query);
    try {
      const response = await fetch(`/api/sub2api/accounts?${params}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "账号加载失败");
      if (seq !== accountsSeq.current) return;
      setAccounts(data);
      setAccountsError("");
    } catch (reason) {
      if (seq === accountsSeq.current) setAccountsError(reason instanceof Error ? reason.message : "账号加载失败");
    } finally {
      if (seq === accountsSeq.current) setLoading(false);
    }
  }, [page, pageSize, platform, accountStatus, query]);

  const refresh = useCallback((silent = false) => {
    void loadStatus();
    void loadAccounts(silent);
  }, [loadAccounts, loadStatus]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) refresh(true); }, 30_000);
    const visible = () => { if (!document.hidden) refresh(true); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);

  async function openDetail(id: number) {
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await fetch(`/api/sub2api/accounts?id=${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "详情加载失败");
      setDetail(data);
    } catch (reason) {
      setAccountsError(reason instanceof Error ? reason.message : "详情加载失败");
    } finally { setDetailLoading(false); }
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
  }

  const platforms = status?.platforms.map(row => row.platform) ?? [];
  const updatedAt = Math.max(status?.updatedAt ?? 0, accounts?.updatedAt ?? 0);
  const error = accountsError || statusError;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{updatedAt ? `最近更新 ${formatShanghaiDateTime(updatedAt)}` : "每 30 秒自动刷新"}</span>
        <button className="btn" onClick={() => refresh()} disabled={loading}>{loading ? "刷新中…" : "刷新"}</button>
      </div>
      {error && <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><span>{error}</span> <button className="ml-2 underline" onClick={() => refresh()}>重试</button></div>}
      {status ? <Summary status={status} /> : loading && <div className="empty"><span className="loading-spinner" aria-label="加载中" /></div>}

      <section className="section">
        <h2>账号状态</h2>
        <form className="list-toolbar mb-4" onSubmit={submitSearch}>
          <Input tone="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索账号" aria-label="搜索账号" />
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
      <div className="stat-strip mb-4">
        <Stat label="账号" value={health.total.toLocaleString()} extra={`可调度 ${health.schedulable} / 异常 ${health.error}`} />
        <Stat label="限流 / 过期" value={`${health.rateLimited} / ${health.expired}`} />
        <Stat label="并发" value={`${health.currentConcurrency} / ${health.maxConcurrency}`} />
        <Stat label="今日请求" value={today.requests.toLocaleString()} extra={`RPM ${today.rpm.toLocaleString()}`} />
        <Stat label="今日 Token" value={formatCompactNumber(today.totalTokens)} extra={`TPM ${formatCompactNumber(today.tpm)}`} />
        <Stat label="今日费用" value={`$${today.actualCost.toFixed(2)}`} />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
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
  const { state, label } = accountState(account);
  return <tr><td><strong>{account.name || `#${account.id}`}</strong><div className="mono dim">#{account.id}</div></td><td><span className="mono">{account.platform}</span><div className="dim">{account.type}</div></td><td><span className={`status-badge ${state}`}><span className="dot" />{label}</span>{account.tempUnschedulableReason && <div className="dim">{account.tempUnschedulableReason}</div>}</td><td className="mono">{account.currentConcurrency} / {account.concurrency}</td><td>{account.groups.map(group => group.name).join(", ") || "—"}</td><td className="mono">{formatTime(account.lastUsedAt)}</td><td><button className="btn sm ghost" onClick={onDetail}>详情</button></td></tr>;
}

function DetailModal({ detail, loading, onClose }: { detail: AccountDetail | null; loading: boolean; onClose: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-head"><h2>账号状态详情</h2><button className="modal-close" onClick={onClose} aria-label="关闭">×</button></div><div className="modal-body">{loading || !detail ? <div className="empty"><span className="loading-spinner" aria-label="加载中" /></div> : <div className="table-wrap"><table className="table"><tbody>{[
    ["账号", `${detail.name} (#${detail.id})`], ["平台 / 类型", `${detail.platform} / ${detail.type}`], ["状态", accountState(detail).label], ["并发", ratio(detail.currentConcurrency, detail.concurrency)], ["分组", detail.groups.map(group => group.name).join(", ") || "—"], ["倍率", detail.rateMultiplier], ["优先级", detail.priority], ["5h 限额", formatUsageWindow(detail.fiveHour)], ["7d 限额", formatUsageWindow(detail.sevenDay)], ["限流重置", formatTime(detail.rateLimitResetAt)], ["临时不可调度至", formatTime(detail.tempUnschedulableUntil)], ["过期时间", formatTime(detail.expiresAt)], ["会话窗口", detail.sessionWindowStatus || "—"], ["最近错误", detail.errorMessage || "—"],
  ].map(([label, value]) => <tr key={String(label)}><th>{label}</th><td className="mono">{value}</td></tr>)}</tbody></table></div>}</div><div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div></div></div>;
}

function accountState(account: Account) {
  if (account.rateLimited) return { state: "warn", label: "限流中" };
  if (!account.schedulable) return { state: "warn", label: "不可调度" };
  if (account.status !== "active") return { state: "err", label: account.status || "异常" };
  return { state: "ok", label: "正常" };
}

function Stat({ label, value, extra }: { label: string; value: string; extra?: string }) { return <div className="stat"><div className="label">{label}</div><div className="value">{value}</div>{extra && <div className="extra">{extra}</div>}</div>; }
function formatCompactNumber(value: number) { return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function ratio(value: number, max: number) { return max > 0 ? `${value.toLocaleString()} / ${max.toLocaleString()}` : `${value.toLocaleString()} / —`; }
function formatTime(value: number | string | null) { if (value === null || value === "") return "—"; const raw = typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value; const timestamp = typeof raw === "number" ? raw : Date.parse(raw); return Number.isFinite(timestamp) ? formatShanghaiDateTime(timestamp) : "—"; }
function formatUsageWindow(window: AccountDetail["fiveHour"]) { return window ? `${window.utilization.toFixed(1)}% · 重置 ${formatTime(window.resetsAt)}` : "—"; }

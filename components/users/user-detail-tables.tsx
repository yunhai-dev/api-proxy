"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";
import { statusLabel } from "@/lib/utils";
import { formatShanghaiDateTime } from "@/lib/time";

type DetailKey = { id: string; name: string; prefix: string; status: string; periodStats: { requests: number; tokens: number; cost: number } };
type ModelStat = { model: string; requests: number; tokens: number; cost: number };
type RecentLog = { id: number; ts: number; model: string; status: number; tokensIn: number; tokensOut: number; cacheReadTokens: number; cacheCreationTokens: number };
const pageSize = 10;

export function UserDetailTables({ keys, models, recentLogs }: { keys: DetailKey[]; models: ModelStat[]; recentLogs: RecentLog[] }) {
  return (
    <>
      <UserKeysTable rows={keys} />
      <UserModelsTable rows={models} />
      <UserRecentLogsTable rows={recentLogs} />
    </>
  );
}

function UserKeysTable({ rows }: { rows: DetailKey[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query, statusFilter]);
  const filtered = rows.filter(row => {
    const q = query.trim().toLowerCase();
    return (!q || row.name.toLowerCase().includes(q) || row.prefix.toLowerCase().includes(q)) && (statusFilter === "all" || row.status === statusFilter);
  });
  const { sortedRows, sortHeader } = useSortableRows(filtered, { name: row => row.name, prefix: row => row.prefix, status: row => row.status, requests: row => row.periodStats.requests, tokens: row => row.periodStats.tokens, cost: row => row.periodStats.cost }, "tokens", "desc");
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const pageRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <section className="section">
      <h2>绑定 API Key</h2>
      <div className="list-toolbar"><Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索 Key 名称 / 前缀" /><Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "active", label: "活跃" }, { value: "disabled", label: "已停用" }]} /><span className="spacer" /><span className="mono dim">{filtered.length} keys</span></div>
      <div className="table-wrap"><table className="table"><thead><tr>{sortHeader("name", "名称")}{sortHeader("prefix", "前缀")}{sortHeader("status", "状态")}{sortHeader("requests", "区间请求")}{sortHeader("tokens", "区间 Token")}{sortHeader("cost", "区间消费")}</tr></thead><tbody>{pageRows.length === 0 && <tr><td colSpan={6} className="empty">暂无匹配 Key</td></tr>}{pageRows.map(k => <tr key={k.id}><td>{k.name}</td><td className="mono">{k.prefix}</td><td>{k.status}</td><td className="mono">{k.periodStats.requests}</td><td className="mono">{k.periodStats.tokens.toLocaleString()}</td><td className="mono">${k.periodStats.cost.toFixed(4)}</td></tr>)}</tbody></table></div>
      <ListPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
    </section>
  );
}

function UserModelsTable({ rows }: { rows: ModelStat[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query]);
  const filtered = rows.filter(row => !query.trim() || row.model.toLowerCase().includes(query.trim().toLowerCase()));
  const { sortedRows, sortHeader } = useSortableRows(filtered, { model: row => row.model, requests: row => row.requests, tokens: row => row.tokens, cost: row => row.cost }, "tokens", "desc");
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const pageRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <section className="section">
      <h2>模型统计</h2>
      <div className="list-toolbar"><Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型" /><span className="spacer" /><span className="mono dim">{filtered.length} models</span></div>
      <div className="table-wrap"><table className="table"><thead><tr>{sortHeader("model", "模型")}{sortHeader("requests", "请求")}{sortHeader("tokens", "Token")}{sortHeader("cost", "消费")}</tr></thead><tbody>{pageRows.length === 0 && <tr><td colSpan={4} className="empty">暂无匹配模型数据</td></tr>}{pageRows.map(m => <tr key={m.model}><td className="mono">{m.model}</td><td className="mono">{m.requests}</td><td className="mono">{m.tokens.toLocaleString()}</td><td className="mono">${m.cost.toFixed(4)}</td></tr>)}</tbody></table></div>
      <ListPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
    </section>
  );
}

function UserRecentLogsTable({ rows }: { rows: RecentLog[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query, statusFilter]);
  const filtered = rows.filter(row => {
    const q = query.trim().toLowerCase();
    const matchesStatus = statusFilter === "all" || (statusFilter === "2xx" ? row.status >= 200 && row.status < 300 : statusFilter === "4xx" ? row.status >= 400 && row.status < 500 : row.status >= 500 || row.status === 0);
    return (!q || row.model.toLowerCase().includes(q)) && matchesStatus;
  });
  const { sortedRows, sortHeader } = useSortableRows(filtered, { ts: row => row.ts, model: row => row.model, status: row => row.status, tokens: row => row.tokensIn + row.tokensOut + row.cacheReadTokens + row.cacheCreationTokens }, "ts", "desc");
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const pageRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <section className="section">
      <h2>最近请求</h2>
      <div className="list-toolbar"><Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型" /><Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "2xx", label: "2xx" }, { value: "4xx", label: "4xx" }, { value: "5xx", label: "5xx/网络错误" }]} /><span className="spacer" /><span className="mono dim">{filtered.length} requests</span></div>
      <div className="table-wrap"><table className="table"><thead><tr>{sortHeader("ts", "时间")}{sortHeader("model", "模型")}{sortHeader("status", "状态")}{sortHeader("tokens", "Token")}</tr></thead><tbody>{pageRows.length === 0 && <tr><td colSpan={4} className="empty">暂无匹配请求</td></tr>}{pageRows.map(log => <tr key={log.id}><td className="mono dim">{formatShanghaiDateTime(log.ts)}</td><td className="mono">{log.model}</td><td>{statusLabel(log.status)}</td><td className="mono">{(log.tokensIn + log.tokensOut + log.cacheReadTokens + log.cacheCreationTokens).toLocaleString()}</td></tr>)}</tbody></table></div>
      <ListPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
    </section>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { TopRankingBarChart } from "@/components/rankings/top-ranking-bar-chart";
import { fmtRelativeTime } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";
import { useEffect, useState } from "react";

type TopUser = {
  id: string;
  name: string;
  username: string;
  last: number;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
};

type TopKey = {
  id: string;
  name: string;
  prefix: string;
  last: number;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
};

type ModelStat = {
  provider: "claude" | "openai";
  model: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  cost: number;
};
const DEFAULT_PAGE_SIZE = 20;
type RankingTab = "keys" | "users" | "models";

export function RankingsTabs({ tab, topKeys, topUsers, modelStats }: { tab: RankingTab; topKeys: TopKey[]; topUsers: TopUser[]; modelStats: ModelStat[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setTab(next: RankingTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/rankings?${params.toString()}`);
  }

  return (
    <section className="list-section">
      <div className="rank-tabs">
        <button type="button" className={tab === "keys" ? "active" : ""} onClick={() => setTab("keys")}>密钥</button>
        <button type="button" className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>用户</button>
        <button type="button" className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}>模型</button>
      </div>

      {tab === "keys" ? <KeyTable rows={topKeys} /> : tab === "users" ? <UserTable rows={topUsers} /> : <ModelTable rows={modelStats} />}
    </section>
  );
}

function KeyTable({ rows }: { rows: TopKey[] }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const { sortedRows, sortHeader } = useSortableRows(rows, {
    name: row => row.name,
    prefix: row => row.prefix,
    requests: row => row.requests,
    totalTokens: row => row.totalTokens,
    tokensIn: row => row.tokensIn,
    tokensOut: row => row.tokensOut,
    cacheReadTokens: row => row.cacheReadTokens,
    cacheCreationTokens: row => row.cacheCreationTokens,
    cost: row => row.cost,
    last: row => row.last,
  }, "totalTokens", "desc");
  const chartRows = sortedRows.slice(0, 10).map(row => ({
    id: row.id,
    label: row.name,
    value: row.totalTokens,
    requests: row.requests,
    cost: row.cost,
    tone: "key" as const,
  }));
  const pageRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <>
      <TopRankingBarChart rows={chartRows} emptyText="当前时间范围暂无密钥消耗数据" />
      <div className="table-wrap">
      <table className="table key-stats-table">
        <thead><tr>{sortHeader("name", "密钥")}{sortHeader("prefix", "前缀")}{sortHeader("requests", "请求数", "right")}{sortHeader("totalTokens", "Token 总数", "right")}{sortHeader("tokensIn", "输入", "right")}{sortHeader("tokensOut", "输出", "right")}{sortHeader("cacheReadTokens", "命中", "right")}{sortHeader("cacheCreationTokens", "创建", "right")}{sortHeader("cost", "费用", "right")}{sortHeader("last", "最后使用")}</tr></thead>
        <tbody>
          {pageRows.length === 0 && <tr><td colSpan={10} className="empty">无匹配密钥 <span className="mono dim">// no rows</span></td></tr>}
          {pageRows.map(k => <tr key={k.id}><td>{k.name}</td><td className="mono dim">{k.prefix}</td><td className="right mono">{k.requests.toLocaleString()}</td><td className="right mono">{fmtTokenValue(k.totalTokens / 1_000_000)}</td><td className="right mono">{fmtTokenValue(k.tokensIn / 1_000_000)}</td><td className="right mono">{fmtTokenValue(k.tokensOut / 1_000_000)}</td><td className="right mono">{fmtTokenValue(k.cacheReadTokens / 1_000_000)}</td><td className="right mono">{fmtTokenValue(k.cacheCreationTokens / 1_000_000)}</td><td className="right mono">${k.cost.toFixed(2)}</td><td className="mono dim">{fmtRelativeTime(k.last)}</td></tr>)}
        </tbody>
      </table>
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </>
  );
}

function UserTable({ rows }: { rows: TopUser[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query]);
  const filtered = rows.filter(row => {
    const q = query.trim().toLowerCase();
    return !q || row.name.toLowerCase().includes(q) || row.username.toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const { sortedRows, sortHeader } = useSortableRows(filtered, {
    name: row => row.name,
    username: row => row.username,
    requests: row => row.requests,
    totalTokens: row => row.totalTokens,
    tokensIn: row => row.tokensIn,
    tokensOut: row => row.tokensOut,
    cacheReadTokens: row => row.cacheReadTokens,
    cacheCreationTokens: row => row.cacheCreationTokens,
    cost: row => row.cost,
    last: row => row.last,
  }, "totalTokens", "desc");
  const chartRows = sortedRows.slice(0, 10).map(row => ({
    id: row.id,
    label: row.name,
    value: row.totalTokens,
    requests: row.requests,
    cost: row.cost,
    tone: "user" as const,
  }));
  const pageRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <>
      <div className="list-toolbar"><Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索用户 / 用户名" /><span className="spacer" /><span className="mono dim">{filtered.length} 位用户</span></div>
      <TopRankingBarChart rows={chartRows} emptyText="当前时间范围暂无用户消耗数据" />
      <div className="table-wrap">
      <table className="table key-stats-table">
        <thead><tr>{sortHeader("name", "用户")}{sortHeader("username", "用户名")}{sortHeader("requests", "请求数", "right")}{sortHeader("totalTokens", "Token 总数", "right")}{sortHeader("tokensIn", "输入", "right")}{sortHeader("tokensOut", "输出", "right")}{sortHeader("cacheReadTokens", "命中", "right")}{sortHeader("cacheCreationTokens", "创建", "right")}{sortHeader("cost", "费用", "right")}{sortHeader("last", "最后使用")}</tr></thead>
        <tbody>
          {pageRows.length === 0 && <tr><td colSpan={10} className="empty">无匹配用户 <span className="mono dim">// no rows</span></td></tr>}
          {pageRows.map(u => <tr key={u.id}><td>{u.name}</td><td className="mono dim">{u.username}</td><td className="right mono">{u.requests.toLocaleString()}</td><td className="right mono">{fmtTokenValue(u.totalTokens / 1_000_000)}</td><td className="right mono">{fmtTokenValue(u.tokensIn / 1_000_000)}</td><td className="right mono">{fmtTokenValue(u.tokensOut / 1_000_000)}</td><td className="right mono">{fmtTokenValue(u.cacheReadTokens / 1_000_000)}</td><td className="right mono">{fmtTokenValue(u.cacheCreationTokens / 1_000_000)}</td><td className="right mono">${u.cost.toFixed(2)}</td><td className="mono dim">{fmtRelativeTime(u.last)}</td></tr>)}
        </tbody>
      </table>
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </>
  );
}

function ModelTable({ rows }: { rows: ModelStat[] }) {
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, providerFilter]);
  const filtered = rows.filter(row => {
    const q = query.trim().toLowerCase();
    return (!q || row.model.toLowerCase().includes(q)) && (providerFilter === "all" || row.provider === providerFilter);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const { sortedRows, sortHeader } = useSortableRows(filtered, {
    model: row => row.model,
    provider: row => row.provider,
    requests: row => row.requests,
    totalTokens: row => row.totalTokens,
    tokensIn: row => row.tokensIn,
    tokensOut: row => row.tokensOut,
    cacheReadTokens: row => row.cacheReadTokens,
    cacheCreationTokens: row => row.cacheCreationTokens,
    cost: row => row.cost,
  }, "totalTokens", "desc");
  const chartRows = sortedRows.slice(0, 10).map(row => ({
    id: `${row.provider}:${row.model}`,
    label: row.model,
    value: row.totalTokens,
    requests: row.requests,
    cost: row.cost,
    tone: row.provider,
  }));
  const pageRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型" />
        <div className="provider-tabs" aria-label="筛选服务商">
          {[
            ["all", "全部"],
            ["claude", "Claude"],
            ["openai", "OpenAI"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`provider-tab ${value} ${providerFilter === value ? "active" : ""}`}
              onClick={() => setProviderFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="mono dim">{filtered.length} 个模型</span>
      </div>
      <TopRankingBarChart rows={chartRows} emptyText="当前时间范围暂无模型消耗数据" />
      <div className="table-wrap">
      <table className="table model-stats-table">
        <thead><tr>{sortHeader("model", "模型")}{sortHeader("provider", "供应商")}{sortHeader("requests", "请求总数", "right")}{sortHeader("totalTokens", "Token 总数", "right")}{sortHeader("tokensIn", "输入", "right")}{sortHeader("tokensOut", "输出", "right")}{sortHeader("cacheReadTokens", "命中", "right")}{sortHeader("cacheCreationTokens", "创建", "right")}{sortHeader("cost", "费用", "right")}</tr></thead>
        <tbody>
          {pageRows.length === 0 && <tr><td colSpan={9} className="empty">暂无匹配模型消耗数据 <span className="mono dim">// no rows</span></td></tr>}
          {pageRows.map(m => <tr key={`${m.provider}:${m.model}`}><td className="mono">{m.model}</td><td><span className={`type-pill ${m.provider}`}>{m.provider === "claude" ? "Claude" : "OpenAI"}</span></td><td className="right mono">{m.requests.toLocaleString()}</td><td className="right mono">{fmtTokenValue(m.totalTokens / 1_000_000)}</td><td className="right mono">{fmtTokenValue(m.tokensIn / 1_000_000)}</td><td className="right mono">{fmtTokenValue(m.tokensOut / 1_000_000)}</td><td className="right mono">{fmtTokenValue(m.cacheReadTokens / 1_000_000)}</td><td className="right mono">{fmtTokenValue(m.cacheCreationTokens / 1_000_000)}</td><td className="right mono">${m.cost.toFixed(2)}</td></tr>)}
        </tbody>
      </table>
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </>
  );
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

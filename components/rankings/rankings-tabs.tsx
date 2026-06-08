"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { fmtRelativeTime } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useEffect, useState } from "react";

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
const pageSize = 20;

export function RankingsTabs({ tab, topKeys, modelStats }: { tab: "keys" | "models"; topKeys: TopKey[]; modelStats: ModelStat[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setTab(next: "keys" | "models") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/rankings?${params.toString()}`);
  }

  return (
    <section className="section">
      <div className="rank-tabs">
        <button type="button" className={tab === "keys" ? "active" : ""} onClick={() => setTab("keys")}>API Key</button>
        <button type="button" className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}>模型</button>
      </div>

      {tab === "keys" ? <KeyTable rows={topKeys} /> : <ModelTable rows={modelStats} />}
    </section>
  );
}

function KeyTable({ rows }: { rows: TopKey[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query]);
  const filtered = rows.filter(row => {
    const q = query.trim().toLowerCase();
    return !q || row.name.toLowerCase().includes(q) || row.prefix.toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <>
      <div className="list-toolbar"><Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索 Key 名称 / 前缀" /><span className="spacer" /><span className="mono dim">{filtered.length} keys</span></div>
      <table className="table key-stats-table">
        <thead><tr><th>API Key</th><th>前缀</th><th className="right">请求数</th><th className="right">Token 总数</th><th className="right">输入</th><th className="right">输出</th><th className="right">命中</th><th className="right">创建</th><th className="right">费用</th><th>最后使用</th></tr></thead>
        <tbody>
          {pageRows.length === 0 && <tr><td colSpan={10} className="empty">无匹配密钥</td></tr>}
          {pageRows.map(k => <tr key={k.id}><td>{k.name}</td><td className="mono dim">{k.prefix}…</td><td className="right mono">{k.requests.toLocaleString()}</td><td className="right mono">{fmtTokenValue(k.totalTokens / 1_000_000)}</td><td className="right mono">{fmtTokenValue(k.tokensIn / 1_000_000)}</td><td className="right mono">{fmtTokenValue(k.tokensOut / 1_000_000)}</td><td className="right mono">{fmtTokenValue(k.cacheReadTokens / 1_000_000)}</td><td className="right mono">{fmtTokenValue(k.cacheCreationTokens / 1_000_000)}</td><td className="right mono">${k.cost.toFixed(2)}</td><td className="mono dim">{fmtRelativeTime(k.last)}</td></tr>)}
        </tbody>
      </table>
      <ListPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
    </>
  );
}

function ModelTable({ rows }: { rows: ModelStat[] }) {
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query, providerFilter]);
  const filtered = rows.filter(row => {
    const q = query.trim().toLowerCase();
    return (!q || row.model.toLowerCase().includes(q)) && (providerFilter === "all" || row.provider === providerFilter);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  return (
    <>
      <div className="list-toolbar"><Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型" /><Select value={providerFilter} onChange={setProviderFilter} options={[{ value: "all", label: "全部服务商" }, { value: "claude", label: "Claude" }, { value: "openai", label: "OpenAI" }]} /><span className="spacer" /><span className="mono dim">{filtered.length} models</span></div>
      <table className="table model-stats-table">
        <thead><tr><th>模型</th><th>供应商</th><th className="right">请求总数</th><th className="right">Token 总数</th><th className="right">输入</th><th className="right">输出</th><th className="right">命中</th><th className="right">创建</th><th className="right">费用</th></tr></thead>
        <tbody>
          {pageRows.length === 0 && <tr><td colSpan={9} className="empty">暂无匹配模型消耗数据</td></tr>}
          {pageRows.map(m => <tr key={`${m.provider}:${m.model}`}><td className="mono">{m.model}</td><td><span className={`type-pill ${m.provider}`}>{m.provider}</span></td><td className="right mono">{m.requests.toLocaleString()}</td><td className="right mono">{fmtTokenValue(m.totalTokens / 1_000_000)}</td><td className="right mono">{fmtTokenValue(m.tokensIn / 1_000_000)}</td><td className="right mono">{fmtTokenValue(m.tokensOut / 1_000_000)}</td><td className="right mono">{fmtTokenValue(m.cacheReadTokens / 1_000_000)}</td><td className="right mono">{fmtTokenValue(m.cacheCreationTokens / 1_000_000)}</td><td className="right mono">${m.cost.toFixed(2)}</td></tr>)}
        </tbody>
      </table>
      <ListPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
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

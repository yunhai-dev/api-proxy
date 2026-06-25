"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { fmtRelativeTime } from "@/lib/utils";

type TestLog = { id: number; ts: number; ok: boolean; latencyMs: number };
type ChannelHealth = { id: string; name: string; type: "claude" | "openai"; status: "ok" | "warn" | "err"; p50Ms: number; testLogs: TestLog[]; recentTestLogs?: TestLog[] };
const pageSize = 12;

export function ChannelHealthList({ rows }: { rows: ChannelHealth[] }) {
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query, providerFilter, statusFilter]);

  const filtered = rows.filter(row => {
    const q = query.trim().toLowerCase();
    return (!q || row.name.toLowerCase().includes(q)) && (providerFilter === "all" || row.type === providerFilter) && (statusFilter === "all" || row.status === statusFilter);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索渠道名称" />
        <Select value={providerFilter} onChange={setProviderFilter} options={[{ value: "all", label: "全部服务商" }, { value: "claude", label: "Claude" }, { value: "openai", label: "OpenAI" }]} />
        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "ok", label: "正常" }, { value: "warn", label: "限流" }, { value: "err", label: "降级" }]} />
        <span className="spacer" />
        <span className="mono dim">{filtered.length} channels</span>
      </div>
      <div className="channel-health-grid">
        {pageRows.length === 0 && <div className="empty">暂无匹配渠道</div>}
        {pageRows.map(c => {
          const latencyPct = Math.min(100, c.p50Ms / 30);
          const statusText = c.status === "ok" ? "正常" : c.status === "warn" ? "限流" : "降级";
          const recentTests = c.recentTestLogs ?? c.testLogs.slice(-36);
          const availability = c.testLogs.length > 0 ? (c.testLogs.filter(log => log.ok).length / c.testLogs.length) * 100 : null;
          const testSlots = Array.from({ length: 36 }, (_, i) => recentTests[i - (36 - recentTests.length)] ?? null);
          return (
            <div className={`channel-health-card ${c.status}`} key={c.id}>
              <div className="channel-health-head"><div><div className="name">{c.name}</div><span className={`type-pill ${c.type}`}>{c.type}</span></div><span className={`status-badge ${c.status}`}><span className="dot" />{statusText}</span></div>
              <div className="channel-health-metrics"><div><span className="label">P50</span><strong className="mono">{c.p50Ms}<small>ms</small></strong></div><div className={`availability-metric ${availability !== null && availability < 99 ? "warn" : ""} ${availability !== null && availability < 95 ? "err" : ""}`}><span className="label">可用性</span><strong className="mono availability-rate">{availability === null ? "—" : <>{availability.toFixed(1)}<small>%</small></>}</strong></div></div>
              <div className="channel-health-track"><i style={{ width: `${latencyPct}%` }} /></div>
              <div className={`channel-test-stripes ${recentTests.length === 0 ? "no-tests" : ""}`} title="最新测试记录">
                {testSlots.map((log, i) => log ? <span key={log.id} className={log.ok ? "ok" : "err"} data-tip={`${log.ok ? "成功" : "失败"} · ${log.latencyMs}ms · ${fmtRelativeTime(log.ts)}`} aria-label={`${log.ok ? "成功" : "失败"}，延迟 ${log.latencyMs}ms，${fmtRelativeTime(log.ts)}`} /> : <span key={`empty-${i}`} className="empty-stripe" />)}
              </div>
            </div>
          );
        })}
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
    </>
  );
}

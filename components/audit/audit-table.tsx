"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";
import { fmtRelativeTime } from "@/lib/utils";

type Activity = { id: number; ts: number; event: string; actor: string };
const DEFAULT_PAGE_SIZE = 20;

export function AuditTable({ rows: initialRows }: { rows: Activity[] }) {
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(initialRows.length);
  const [loading, setLoading] = useState(false);
  const { sortedRows, sortHeader, sort } = useSortableRows(rows, {
    ts: row => row.ts,
    event: row => row.event,
    actor: row => row.actor,
  }, "ts", "desc");
  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), query });
    params.set("sort", sort.key);
    params.set("sortDir", sort.dir);
    try {
      const r = await fetch(`/api/activity?${params}`);
      if (!r.ok) return;
      const data = await r.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [page, pageSize, query, sort.key, sort.dir]);
  useEffect(() => { setPage(1); }, [query, sort.key, sort.dir]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  return (
    <>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索事件 / 操作人" />
        <span className="spacer" />
        <span className="mono dim">{loading ? <span className="loading-spinner" aria-label="加载中" /> : `${total} 条记录`}</span>
      </div>
      <div className="table-wrap">
      <table className="table">
        <thead><tr>{sortHeader("ts", "时间")}{sortHeader("event", "事件")}{sortHeader("actor", "操作人")}</tr></thead>
        <tbody>
          {loading && <tr><td colSpan={3} className="empty"><span className="loading-spinner" aria-label="加载中" /></td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={3} className="empty">暂无匹配审计日志 <span className="mono dim">// no rows</span></td></tr>}
          {sortedRows.map(row => <tr key={row.id}><td className="mono dim">{fmtRelativeTime(row.ts)}</td><td>{row.event}</td><td className="mono dim">{row.actor}</td></tr>)}
        </tbody>
      </table>
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </>
  );
}

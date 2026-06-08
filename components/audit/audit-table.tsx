"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { fmtRelativeTime } from "@/lib/utils";

type Activity = { id: number; ts: number; event: string; actor: string };
const pageSize = 20;

export function AuditTable({ rows }: { rows: Activity[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query]);

  const filtered = rows.filter(row => {
    const q = query.trim().toLowerCase();
    return !q || row.event.toLowerCase().includes(q) || row.actor.toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索事件 / 操作人" />
        <span className="spacer" />
        <span className="mono dim">{filtered.length} activities</span>
      </div>
      <table className="table">
        <thead><tr><th>时间</th><th>事件</th><th>操作人</th></tr></thead>
        <tbody>
          {pageRows.length === 0 && <tr><td colSpan={3} className="empty">暂无匹配审计日志</td></tr>}
          {pageRows.map(row => <tr key={row.id}><td className="mono dim">{fmtRelativeTime(row.ts)}</td><td>{row.event}</td><td className="mono dim">{row.actor}</td></tr>)}
        </tbody>
      </table>
      <ListPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
    </>
  );
}

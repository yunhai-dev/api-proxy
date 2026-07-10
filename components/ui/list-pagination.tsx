"use client";

import { Select } from "@/components/ui/select";

type ListPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
};

export function ListPagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [10, 20, 50, 100] }: ListPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);

  function changePageSize(value: string) {
    onPageSizeChange?.(Number(value));
    onPageChange(1);
  }

  return (
    <div className="list-pagination">
      <span className="mono dim">{start}-{end} 条 / 共 {total} 条</span>
      <div className="list-pagination-actions">
        {onPageSizeChange && (
          <Select
            size="sm"
            value={String(pageSize)}
            onChange={changePageSize}
            options={pageSizeOptions.map(size => ({ value: String(size), label: `${size} / 页` }))}
          />
        )}
        <button className="btn sm ghost" onClick={() => onPageChange(1)} disabled={safePage <= 1}>首页</button>
        <button className="btn sm ghost" onClick={() => onPageChange(safePage - 1)} disabled={safePage <= 1}>上一页</button>
        <span className="mono dim">{safePage} / {totalPages}</span>
        <button className="btn sm ghost" onClick={() => onPageChange(safePage + 1)} disabled={safePage >= totalPages}>下一页</button>
        <button className="btn sm ghost" onClick={() => onPageChange(totalPages)} disabled={safePage >= totalPages}>末页</button>
      </div>
    </div>
  );
}

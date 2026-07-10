"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";
import { formatShanghaiDateTime } from "@/lib/time";

type GiftCard = {
  id: string;
  codePrefix: string;
  codeSuffix: string;
  amountUsd: number;
  status: "active" | "redeemed";
  createdBy: string;
  redeemedBy: string | null;
  redeemedAt: number | null;
  createdAt: number;
};

type CreatedCard = GiftCard & { code: string };
const DEFAULT_PAGE_SIZE = 20;

export function AdminGiftCards() {
  const toast = useToast();
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [created, setCreated] = useState<CreatedCard[]>([]);
  const [amountUsd, setAmountUsd] = useState("10");
  const [count, setCount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const { sortedRows, sortHeader, sort } = useSortableRows(cards, {
    code: row => `${row.codePrefix}${row.codeSuffix}`,
    amountUsd: row => row.amountUsd,
    status: row => row.status,
    createdAt: row => row.createdAt,
    redeemedBy: row => row.redeemedBy ?? "",
    redeemedAt: row => row.redeemedAt ?? 0,
  }, "createdAt", "desc");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), query, status: statusFilter });
    params.set("sort", sort.key);
    params.set("sortDir", sort.dir);
    try {
      const res = await fetch(`/api/gift-cards?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCards(data.rows ?? []);
        setTotal(data.total ?? 0);
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [page, pageSize, query, statusFilter, sort.key, sort.dir]);
  useEffect(() => { setPage(1); }, [query, statusFilter, sort.key, sort.dir]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const allSelected = cards.length > 0 && cards.every(card => selected.has(card.id));

  async function createCards(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setCreated([]);
    try {
      const res = await fetch("/api/gift-cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountUsd: Number(amountUsd), count: Number(count) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || "生成失败"); return; }
      setCreated(data.cards ?? []);
      setOpen(true);
      toast(`已生成 ${data.cards?.length ?? 0} 张礼品卡`);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function copyAllCreated() {
    if (created.length === 0) return;
    const text = created.map(card => card.code).join("\n");
    await navigator.clipboard.writeText(text);
    toast(`已复制 ${created.length} 张礼品卡`);
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(cards.map(card => card.id)));
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelected() {
    if (selected.size === 0 || !confirm(`确认删除 ${selected.size} 张礼品卡？`)) return;
    const ids = [...selected];
    const res = await fetch("/api/gift-cards", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error || "删除失败"); return; }
    setSelected(new Set());
    toast(`已删除 ${data.deleted ?? ids.length} 张礼品卡`);
    load();
  }

  return (
    <div className="gift-card-layout">
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索卡号 / 创建人 / 核销用户" />
        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "active", label: "可核销" }, { value: "redeemed", label: "已核销" }]} />
        <span className="spacer" />
        {selected.size > 0 && <button className="btn danger" onClick={deleteSelected}>删除选中 <span className="mono kbd">{selected.size}</span></button>}
        <button className="btn primary" onClick={() => { setCreated([]); setOpen(true); }}>+ 生成礼品卡 <span className="mono kbd">G</span></button>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal gift-card-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>生成礼品卡</h2>
              <button className="modal-close" onClick={() => setOpen(false)} disabled={busy} aria-label="关闭">×</button>
            </div>
            <form onSubmit={createCards}>
              <div className="modal-body gift-card-create">
                <p className="dim">卡号只会在生成后显示一次，数据库仅保存哈希。请在生成后立即复制保存。</p>
                <div className="gift-card-form-grid">
                  <div className="field"><label>金额 USD</label><input className="mono" value={amountUsd} onChange={e => setAmountUsd(e.target.value)} inputMode="decimal" autoFocus /></div>
                  <div className="field"><label>数量</label><input className="mono" value={count} onChange={e => setCount(e.target.value)} inputMode="numeric" /></div>
                </div>
                {created.length > 0 && (
                  <div className="gift-card-created">
                    <div className="gift-card-created-head">
                      <h3>新生成卡号</h3>
                      <button type="button" className="btn sm ghost" onClick={copyAllCreated}>复制全部</button>
                    </div>
                    <div className="gift-card-code-list mono">
                      {created.map(card => <div key={card.id}>{card.code} <span>${card.amountUsd.toFixed(2)}</span></div>)}
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-foot">
                <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>关闭</button>
                <button className="btn primary" disabled={busy}>{busy ? "生成中…" : "生成"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className="list-section">
        <h2>礼品卡记录</h2>
        <div className="table-wrap">
        <table className="table">
          <thead><tr><th><button type="button" className={`check-control ${allSelected ? "checked" : ""}`} onClick={toggleAll} aria-label="全选礼品卡" aria-pressed={allSelected} /></th>{sortHeader("code", "卡号")}{sortHeader("amountUsd", "金额")}{sortHeader("status", "状态")}{sortHeader("createdAt", "创建时间")}{sortHeader("redeemedBy", "核销用户")}{sortHeader("redeemedAt", "核销时间")}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="empty"><span className="loading-spinner" aria-label="加载中" /></td></tr>}
            {!loading && cards.length === 0 && <tr><td colSpan={7} className="empty">暂无匹配礼品卡 <span className="mono dim">// no rows</span></td></tr>}
            {sortedRows.map(card => (
              <tr key={card.id}>
                <td><button type="button" className={`check-control ${selected.has(card.id) ? "checked" : ""}`} onClick={() => toggleOne(card.id)} aria-label={`选择礼品卡 ${card.codePrefix}${card.codeSuffix}`} aria-pressed={selected.has(card.id)} /></td>
                <td className="mono">{card.codePrefix}****{card.codeSuffix}</td>
                <td className="mono">${card.amountUsd.toFixed(2)}</td>
                <td>{card.status === "active" ? <span className="status ok"><span className="dot ok" />可核销</span> : <span className="status"><span className="dot" />已核销</span>}</td>
                <td className="mono dim">{formatShanghaiDateTime(card.createdAt)}</td>
                <td className="mono dim">{card.redeemedBy || "—"}</td>
                <td className="mono dim">{card.redeemedAt ? formatShanghaiDateTime(card.redeemedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <ListPagination page={safePage} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </section>
    </div>
  );
}

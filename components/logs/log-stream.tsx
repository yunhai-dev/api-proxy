"use client";

import { useEffect, useRef, useState } from "react";
import { fmtClockStamp, statusClass, statusLabel } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";

type LogEntry = {
  id: number;
  requestId: string;
  ts: number;
  keyId: string;
  keyName: string;
  keyPrefix: string;
  channelId: string;
  channelName: string;
  channelType: "claude" | "openai";
  model: string;
  inboundModel: string;
  upstreamModel: string;
  mappingId: string;
  mappedChannelIds: string[];
  status: number;
  latencyMs: number;
  ttftMs: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  cacheTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  hasDetail: boolean;
  cost: number;
};

type LogDetail = Pick<LogEntry, "id" | "requestId" | "status" | "model" | "inboundModel" | "upstreamModel"> & {
  requestDetail: string | null;
  errorMsg: string | null;
};

const STATUSES = ["all", "2xx", "4xx", "5xx", "err"] as const;
type StatusFilter = (typeof STATUSES)[number];
type UserOption = { id: string; username: string; displayName: string };
const pageSize = 50;

function providerLabel(provider: LogEntry["channelType"]) {
  return provider === "claude" ? "Claude" : "OpenAI";
}

function tokenText(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString();
}

export function LogStream({ initial, mode = "user", users = [] }: { initial: LogEntry[]; mode?: "user" | "admin"; users?: UserOption[] }) {
  const isAdminMode = mode === "admin";
  const [rows, setRows] = useState<LogEntry[]>(initial);
  const [selectedUserId, setSelectedUserId] = useState("all");
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initial.length);
  const [loading, setLoading] = useState(false);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [selectedError, setSelectedError] = useState<LogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { sortedRows, sortButton, sort } = useSortableRows(rows, {
    ts: row => row.ts,
    requestId: row => row.requestId,
    keyName: row => row.keyName || row.keyPrefix,
    channelName: row => isAdminMode ? row.channelName : row.channelType,
    model: row => row.inboundModel || row.model,
    status: row => row.status,
    ttftMs: row => row.ttftMs || row.latencyMs,
    durationMs: row => row.durationMs,
    tokensIn: row => row.tokensIn,
    tokensOut: row => row.tokensOut,
    cacheReadTokens: row => row.cacheReadTokens,
    cacheCreationTokens: row => row.cacheCreationTokens,
    cost: row => row.cost,
  }, "ts", "desc");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status, query: search, provider: providerFilter, model: modelFilter });
    if (isAdminMode) params.set("channel", channelFilter);
    params.set("sort", sort.key === "requestId" ? "ts" : sort.key === "ttftMs" || sort.key === "durationMs" ? "latencyMs" : sort.key);
    params.set("sortDir", sort.dir);
    if (isAdminMode) params.set("userId", selectedUserId);
    try {
      const r = await fetch(`/api/logs?${params}`);
      if (!r.ok) return;
      const data = await r.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [mode, selectedUserId, status, search, providerFilter, channelFilter, modelFilter, page, sort.key, sort.dir]);
  useEffect(() => { setPage(1); }, [selectedUserId, status, search, providerFilter, channelFilter, modelFilter, sort.key, sort.dir]);

  useEffect(() => {
    const qs = isAdminMode && selectedUserId !== "all" ? `?userId=${encodeURIComponent(selectedUserId)}` : "";
    const es = new EventSource(`/api/logs/stream${qs}`);
    es.addEventListener("log", (e) => {
      if (pausedRef.current) return;
      try {
        const entry: LogEntry = JSON.parse((e as MessageEvent).data);
        setRows(prev => {
          const idx = prev.findIndex(r => r.id === entry.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = entry;
            return next;
          }
          if (page !== 1 || status !== "all" || search || providerFilter !== "all" || (isAdminMode && channelFilter !== "all") || modelFilter !== "all") return prev;
          setTotal(total => total + 1);
          return [entry, ...prev].slice(0, pageSize);
        });
        setNewIds(prev => new Set(prev).add(entry.id || Date.now()));
        setTimeout(() => {
          setNewIds(prev => {
            const next = new Set(prev);
            next.delete(entry.id || 0);
            return next;
          });
        }, 800);
      } catch { /* */ }
    });
    es.onerror = () => {
      // 让浏览器自动重连
    };
    return () => es.close();
  }, [isAdminMode, selectedUserId, page, status, search, providerFilter, channelFilter, modelFilter]);

  const channelOptions = isAdminMode ? [...new Set(rows.map(r => r.channelName).filter(Boolean))].sort() : [];
  const modelOptions = [...new Set(rows.flatMap(r => [r.inboundModel, r.model]).filter(Boolean))].sort();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  async function openDetail(entry: LogEntry) {
    if (!entry.hasDetail) return;
    setSelectedError({ id: entry.id, requestId: entry.requestId, status: entry.status, model: entry.model, inboundModel: entry.inboundModel, upstreamModel: entry.upstreamModel, requestDetail: null, errorMsg: null });
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/logs/${entry.id}`);
      if (!res.ok) throw new Error("加载失败");
      setSelectedError(await res.json());
    } catch {
      setSelectedError({ id: entry.id, requestId: entry.requestId, status: entry.status, model: entry.model, inboundModel: entry.inboundModel, upstreamModel: entry.upstreamModel, requestDetail: null, errorMsg: "日志详情加载失败" });
    } finally {
      setDetailLoading(false);
    }
  }

  function errorText(entry: LogDetail) {
    const detail = entry.errorMsg ?? entry.requestDetail;
    if (!detail) return "";
    try {
      return JSON.stringify(JSON.parse(detail), null, 2);
    } catch {
      return detail;
    }
  }

  return (
    <>
      <div className="log-toolbar">
        <span className="live-pill">
          <span className="dot live" /> 实时
        </span>
        <div>
          {STATUSES.map(s => (
            <button
              key={s}
              className={`seg-btn ${status === s ? "active" : ""}`}
              onClick={() => setStatus(s)}
            >
              {s === "err" ? "网络错误" : s === "all" ? "全部" : s}
            </button>
          ))}
        </div>
        <Input
          className="log-search"
          tone="search"
          type="text"
          placeholder="请求ID / API Key"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {isAdminMode && (
          <Select
            value={selectedUserId}
            onChange={setSelectedUserId}
            options={[{ value: "all", label: "全部用户" }, ...users.map(u => ({ value: u.id, label: `${u.displayName} (${u.username})` }))]}
          />
        )}
        <Select value={providerFilter} onChange={setProviderFilter} options={[{ value: "all", label: "全部服务商" }, { value: "claude", label: "Claude" }, { value: "openai", label: "OpenAI" }]} />
        {isAdminMode && <Select value={channelFilter} onChange={setChannelFilter} options={[{ value: "all", label: "全部渠道" }, ...channelOptions.map(name => ({ value: name, label: name }))]} />}
        <Select value={modelFilter} onChange={setModelFilter} options={[{ value: "all", label: "全部模型" }, ...modelOptions.map(name => ({ value: name, label: name }))]} />
        <div className="spacer" />
        <span className="dim mono" style={{ fontSize: 11.5 }}>{loading ? <span className="loading-spinner" aria-label="加载中" /> : `${total} logs`}</span>
      </div>

      <div className="log-wrap">
        <div className="log-row head">
          <span>{sortButton("ts", "时间")}</span>
          <span>{sortButton("requestId", "请求ID")}</span>
          <span>{sortButton("keyName", "密钥")}</span>
          <span>{sortButton("channelName", isAdminMode ? "渠道" : "服务商")}</span>
          <span>{sortButton("model", "模型")}</span>
          <span style={{ textAlign: "right" }}>{sortButton("status", "状态")}</span>
          <span style={{ textAlign: "right" }}>{sortButton("ttftMs", "首字")}</span>
          <span style={{ textAlign: "right" }}>{sortButton("durationMs", "完成")}</span>
          <span style={{ textAlign: "right" }}>{sortButton("tokensIn", "输入")}</span>
          <span style={{ textAlign: "right" }}>{sortButton("tokensOut", "输出")}</span>
          <span style={{ textAlign: "right" }}>{sortButton("cacheReadTokens", "命中")}</span>
          <span style={{ textAlign: "right" }}>{sortButton("cacheCreationTokens", "创建")}</span>
          <span style={{ textAlign: "right" }}>{sortButton("cost", "消费")}</span>
        </div>
        {loading && <div className="empty"><span className="loading-spinner" aria-label="加载中" /></div>}
        {!loading && rows.length === 0 && (
          <div className="empty">无日志 <span className="mono">// no rows</span></div>
        )}
        {sortedRows.map((r, i) => {
          const cls = statusClass(r.status);
          const slow = r.latencyMs > 3000;
          const isNew = newIds.has(r.id) || newIds.has(r.ts);
          return (
            <div
              className={`log-row ${r.hasDetail ? "has-error" : ""} ${isNew && i === 0 ? "new" : ""}`}
              key={`${r.id}-${r.ts}`}
              onClick={() => { void openDetail(r); }}
            >
              <span className="ts">{fmtClockStamp(r.ts)}</span>
              <span className="reqid" title={r.requestId}>{r.requestId ? r.requestId.slice(0, 8) : "—"}</span>
              <span className="key">{r.keyPrefix}</span>
              <span className={`channel ${r.channelType}`}>{isAdminMode ? r.channelName : providerLabel(r.channelType)}</span>
              <span className="model" title={r.inboundModel && r.upstreamModel && r.inboundModel !== r.upstreamModel ? `${r.inboundModel} -> ${r.upstreamModel}` : r.model}>
                {r.inboundModel && r.upstreamModel && r.inboundModel !== r.upstreamModel ? `${r.inboundModel} → ${r.upstreamModel}` : r.model}
              </span>
              <span className={cls} style={{ textAlign: "right" }}>{statusLabel(r.status)}{r.hasDetail ? <span className="err-toggle"> 查看</span> : null}</span>
              <span className={`lat ttft ${slow ? "slow" : ""}`}>{r.ttftMs || r.latencyMs || "—"}<span className="dim">ms</span></span>
              <span className={`lat duration ${slow ? "slow" : ""}`}>{r.durationMs > 0 ? <>{r.durationMs}<span className="dim">ms</span></> : <span className="running">进行中</span>}</span>
              <span className="tokens">{tokenText(r.tokensIn)}</span>
              <span className="tokens">{tokenText(r.tokensOut)}</span>
              <span className="tokens cache-token">{tokenText(r.cacheReadTokens)}</span>
              <span className="tokens cache-token create-token">{tokenText(r.cacheCreationTokens)}</span>
              <span className="tokens">{r.cost > 0 ? `$${r.cost.toFixed(6)}` : "—"}</span>
            </div>
          );
        })}
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={total} onPageChange={setPage} />

      {selectedError && (
        <div className="modal-backdrop" onClick={() => setSelectedError(null)}>
          <div className="modal log-error-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{selectedError.errorMsg ? "错误详情" : "请求详情"}</h2>
              <button className="modal-close" type="button" onClick={() => setSelectedError(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="error-meta mono">
                <span>请求ID: {selectedError.requestId || "—"}</span>
                <span>状态: {statusLabel(selectedError.status)}</span>
                <span>模型: {selectedError.inboundModel && selectedError.upstreamModel && selectedError.inboundModel !== selectedError.upstreamModel ? `${selectedError.inboundModel} -> ${selectedError.upstreamModel}` : selectedError.model}</span>
              </div>
              <pre className="error-detail mono">{detailLoading ? "加载中..." : errorText(selectedError)}</pre>
            </div>
            <div className="modal-foot">
              <button className="btn" type="button" onClick={() => setSelectedError(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      <div className="page-actions" style={{ marginTop: 16 }}>
        <button className="btn ghost" onClick={() => setPaused(p => !p)}>
          {paused ? "继续" : "暂停"}
        </button>
        <button className="btn" onClick={() => { setRows([]); setNewIds(new Set()); }}>
          清空
        </button>
      </div>
    </>
  );
}

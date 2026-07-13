"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
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
  inboundModel?: string;
  upstreamModel?: string;
  reasoningEffort?: string;
  mappingId?: string;
  mappedChannelIds?: string[];
  userName?: string;
  username?: string;
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
const DEFAULT_PAGE_SIZE = 50;

function providerLabel(provider: LogEntry["channelType"]) {
  return provider === "claude" ? "Claude" : "OpenAI";
}

function tokenText(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString();
}

function displayModel(row: Pick<LogEntry, "model" | "inboundModel" | "upstreamModel" | "reasoningEffort">, isAdminMode: boolean) {
  const model = !isAdminMode
    ? row.inboundModel || row.model
    : row.inboundModel && row.upstreamModel && row.inboundModel !== row.upstreamModel
      ? `${row.inboundModel} → ${row.upstreamModel}`
      : row.model;
  return row.reasoningEffort ? `${model}（${row.reasoningEffort}）` : model;
}


function displayModelTitle(row: Pick<LogEntry, "model" | "inboundModel" | "upstreamModel" | "reasoningEffort">, isAdminMode: boolean) {
  return displayModel(row, isAdminMode).replace(" → ", " -> ");
}

function DetailViewer({ value, fallback }: { value: unknown; fallback: string }) {
  if (value === null) return <pre className="error-detail mono">{fallback || "无详情"}</pre>;
  return <JsonNode value={value} depth={0} />;
}

function JsonNode({ value, depth }: { value: unknown; depth: number }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="json-empty mono">[]</span>;
    return (
      <div className={depth === 0 ? "json-node mono" : "json-children"}>
        {value.map((item, index) => <JsonRow key={index} name={`[${index}]`} value={item} depth={depth} />)}
      </div>
    );
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="json-empty mono">{"{}"}</span>;
    return (
      <div className={depth === 0 ? "json-node mono" : "json-children"}>
        {entries.map(([key, item]) => <JsonRow key={key} name={key} value={item} depth={depth} />)}
      </div>
    );
  }
  return <JsonValue value={value} />;
}

function JsonRow({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const nested = !isPlainValue(value);
  const [open, setOpen] = useState(depth < 2);
  const count = nested ? childCount(value) : 0;
  return (
    <div className="json-row" style={{ paddingLeft: depth * 14 }}>
      <div className="json-line">
        <button className="json-toggle" type="button" onClick={() => nested && setOpen(v => !v)} disabled={!nested} aria-label={open ? "折叠" : "展开"}>
          {nested ? (open ? "▾" : "▸") : ""}
        </button>
        <span className="json-key" title={name}>{JSON.stringify(name)}</span>
        <span className="json-colon">:</span>
        {nested ? (
          <button className="json-summary" type="button" onClick={() => setOpen(v => !v)}>
            {Array.isArray(value) ? `Array(${count})` : `Object(${count})`}
          </button>
        ) : <JsonValue value={value} />}
      </div>
      {nested && open && <JsonNode value={value} depth={depth + 1} />}
    </div>
  );
}

function JsonValue({ value }: { value: unknown }) {
  const type = value === null ? "null" : typeof value;
  return <span className={`json-value ${type}`}>{typeof value === "string" ? JSON.stringify(value) : String(value)}</span>;
}

function childCount(value: unknown) {
  return Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0;
}

function isPlainValue(value: unknown) {
  return value === null || typeof value !== "object";
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
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(initial.length);
  const [loading, setLoading] = useState(false);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [selectedError, setSelectedError] = useState<LogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { sortedRows, sortButton, sort } = useSortableRows(rows, {
    ts: row => row.ts,
    requestId: row => row.requestId,
    keyName: row => row.keyName || row.keyPrefix,
    userName: row => row.userName || row.username || "",
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

  useEffect(() => { load(); }, [mode, selectedUserId, status, search, providerFilter, channelFilter, modelFilter, page, pageSize, sort.key, sort.dir]);
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
  const modelOptions = [...new Set(rows.flatMap(r => isAdminMode ? [r.inboundModel, r.upstreamModel || r.model] : [r.inboundModel || r.model]).filter((name): name is string => !!name))].sort();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  async function openDetail(entry: LogEntry) {
    if (!isAdminMode || !entry.hasDetail) return;
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

  function detailText(entry: LogDetail) {
    return entry.errorMsg ?? entry.requestDetail ?? "";
  }

  function parsedDetail(entry: LogDetail) {
    const detail = detailText(entry);
    if (!detail) return null;
    try {
      return JSON.parse(detail) as unknown;
    } catch {
      return null;
    }
  }

  return (
    <>
      <div className="log-toolbar">
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
        <Select
          value={status}
          onChange={value => setStatus(value as StatusFilter)}
          options={STATUSES.map(s => ({
            value: s,
            label: s === "err" ? "网络错误" : s === "all" ? "全部状态" : s,
          }))}
        />
        <button className="btn sm ghost icon-btn" onClick={() => setPaused(p => !p)} title={paused ? "继续" : "暂停"} aria-label={paused ? "继续" : "暂停"}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <button className="btn sm ghost icon-btn" onClick={() => { setRows([]); setNewIds(new Set()); }} title="清空" aria-label="清空">
          <Trash2 size={14} />
        </button>
        <div className="spacer" />
        {loading && <span className="loading-spinner" aria-label="加载中" />}
      </div>

      <div className="table-wrap">
        <table className={`table logs-table ${isAdminMode ? "admin" : ""}`}>
          <thead>
            <tr>
              <th>{sortButton("ts", "时间")}</th>
              <th>{sortButton("requestId", "请求ID")}</th>
              <th>{sortButton("keyName", "密钥")}</th>
              {isAdminMode && <th>{sortButton("userName", "用户昵称")}</th>}
              <th>{sortButton("channelName", isAdminMode ? "渠道" : "服务商")}</th>
              <th>{sortButton("model", "模型")}</th>
              <th className="right">{sortButton("status", "状态")}</th>
              <th className="right">{sortButton("ttftMs", "首字")}</th>
              <th className="right">{sortButton("durationMs", "完成")}</th>
              <th className="right">{sortButton("tokensIn", "输入")}</th>
              <th className="right">{sortButton("tokensOut", "输出")}</th>
              <th className="right">{sortButton("cacheReadTokens", "命中")}</th>
              <th className="right">{sortButton("cacheCreationTokens", "创建")}</th>
              <th className="right">{sortButton("cost", "消费")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={isAdminMode ? 14 : 13} className="empty"><span className="loading-spinner" aria-label="加载中" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={isAdminMode ? 14 : 13} className="empty">无日志 <span className="mono">// no rows</span></td></tr>}
            {sortedRows.map((r, i) => {
              const cls = statusClass(r.status);
              const slow = r.latencyMs > 3000;
              const isNew = newIds.has(r.id) || newIds.has(r.ts);
              return (
                <tr
                  className={`${cls} ${isAdminMode && r.hasDetail ? "has-detail" : ""} ${isNew && i === 0 ? "new" : ""}`}
                  key={`${r.id}-${r.ts}`}
                  onClick={isAdminMode && r.hasDetail ? () => { void openDetail(r); } : undefined}
                >
                  <td className="mono dim nowrap">{fmtClockStamp(r.ts)}</td>
                  <td className="mono truncate-cell" title={r.requestId}>{r.requestId ? r.requestId.slice(0, 8) : "—"}</td>
                  <td className="mono truncate-cell" title={r.keyPrefix}>{r.keyPrefix}</td>
                  {isAdminMode && <td className="truncate-cell" title={r.username ? `${r.userName || "未知用户"} (${r.username})` : r.userName || "未知用户"}>{r.userName || "未知用户"}</td>}
                  <td className={`channel truncate-cell ${r.channelType}`} title={isAdminMode ? r.channelName : providerLabel(r.channelType)}>{isAdminMode ? r.channelName : providerLabel(r.channelType)}</td>
                  <td className="mono truncate-cell" title={displayModelTitle(r, isAdminMode)}>{displayModel(r, isAdminMode)}</td>
                  <td className={`right nowrap ${cls}`}>{statusLabel(r.status)}{isAdminMode && r.hasDetail ? <span className="err-toggle"> 查看</span> : null}</td>
                  <td className={`right mono nowrap ${slow ? "slow" : ""}`}>{r.ttftMs || r.latencyMs || "—"}<span className="dim">ms</span></td>
                  <td className={`right mono nowrap ${slow ? "slow" : ""}`}>{r.durationMs > 0 ? <>{r.durationMs}<span className="dim">ms</span></> : <span className="running">进行中</span>}</td>
                  <td className="right mono nowrap">{tokenText(r.tokensIn)}</td>
                  <td className="right mono nowrap">{tokenText(r.tokensOut)}</td>
                  <td className="right mono nowrap cache-token">{tokenText(r.cacheReadTokens)}</td>
                  <td className="right mono nowrap cache-token create-token">{tokenText(r.cacheCreationTokens)}</td>
                  <td className="right mono nowrap">{r.cost > 0 ? `$${r.cost.toFixed(6)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />

      {selectedError && (
        <div className="modal-backdrop" onClick={() => setSelectedError(null)}>
          <div className="modal log-error-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{selectedError.errorMsg ? "错误详情" : "请求详情"}</h2>
              <button className="modal-close" type="button" onClick={() => setSelectedError(null)}>×</button>
            </div>
            <div className="modal-body log-error-body">
              <div className="error-meta mono">
                <span>请求ID: {selectedError.requestId || "—"}</span>
                <span>状态: {statusLabel(selectedError.status)}</span>
                <span>模型: {displayModel(selectedError, isAdminMode)}</span>
              </div>
              {detailLoading ? (
                <div className="error-detail-loading"><span className="loading-spinner" aria-label="加载中" /> 加载中...</div>
              ) : (
                <DetailViewer value={parsedDetail(selectedError)} fallback={detailText(selectedError)} />
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" type="button" onClick={() => setSelectedError(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtClockStamp, statusClass, statusLabel } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";

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
  requestDetail: string | null;
  errorMsg: string | null;
  cost: number;
};

const STATUSES = ["all", "2xx", "4xx", "5xx", "err"] as const;
type StatusFilter = (typeof STATUSES)[number];
type UserOption = { id: string; username: string; displayName: string };
const pageSize = 50;

export function LogStream({ initial, mode = "user", users = [] }: { initial: LogEntry[]; mode?: "user" | "admin"; users?: UserOption[] }) {
  const [rows, setRows] = useState<LogEntry[]>(initial);
  const [selectedUserId, setSelectedUserId] = useState("all");
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [selectedError, setSelectedError] = useState<LogEntry | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (mode !== "admin") return;
    const qs = selectedUserId === "all" ? "" : `?userId=${encodeURIComponent(selectedUserId)}`;
    fetch(`/api/logs${qs}`).then(r => r.ok ? r.json() : []).then(setRows).catch(() => null);
  }, [mode, selectedUserId]);
  useEffect(() => { setPage(1); }, [selectedUserId, status, search, providerFilter, channelFilter, modelFilter]);

  useEffect(() => {
    const qs = mode === "admin" && selectedUserId !== "all" ? `?userId=${encodeURIComponent(selectedUserId)}` : "";
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
          return [entry, ...prev].slice(0, 200);
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
  }, [mode, selectedUserId]);

  const filtered = useMemo(() => {
    let out = rows;
    if (status !== "all") out = out.filter(r => {
      if (status === "2xx") return r.status >= 200 && r.status < 300;
      if (status === "4xx") return r.status >= 400 && r.status < 500;
      if (status === "5xx") return r.status >= 500 && r.status < 600;
      if (status === "err") return r.status === 0 || r.status >= 500;
      return true;
    });
    const s = search.trim().toLowerCase();
    if (s) {
      out = out.filter(r =>
        r.requestId.toLowerCase().includes(s) ||
        r.keyPrefix.toLowerCase().includes(s) ||
        r.keyName.toLowerCase().includes(s) ||
        r.model.toLowerCase().includes(s) ||
        r.channelName.toLowerCase().includes(s)
      );
    }
    if (providerFilter !== "all") out = out.filter(r => r.channelType === providerFilter);
    if (channelFilter !== "all") out = out.filter(r => r.channelName === channelFilter);
    if (modelFilter !== "all") out = out.filter(r => (r.inboundModel || r.model) === modelFilter || r.model === modelFilter);
    return out;
  }, [rows, status, search, providerFilter, channelFilter, modelFilter]);
  const channelOptions = [...new Set(rows.map(r => r.channelName).filter(Boolean))].sort();
  const modelOptions = [...new Set(rows.flatMap(r => [r.inboundModel, r.model]).filter(Boolean))].sort();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function errorText(entry: LogEntry) {
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
        {mode === "admin" && (
          <Select
            value={selectedUserId}
            onChange={setSelectedUserId}
            options={[{ value: "all", label: "全部用户" }, ...users.map(u => ({ value: u.id, label: `${u.displayName} (${u.username})` }))]}
          />
        )}
        <Select value={providerFilter} onChange={setProviderFilter} options={[{ value: "all", label: "全部服务商" }, { value: "claude", label: "Claude" }, { value: "openai", label: "OpenAI" }]} />
        <Select value={channelFilter} onChange={setChannelFilter} options={[{ value: "all", label: "全部渠道" }, ...channelOptions.map(name => ({ value: name, label: name }))]} />
        <Select value={modelFilter} onChange={setModelFilter} options={[{ value: "all", label: "全部模型" }, ...modelOptions.map(name => ({ value: name, label: name }))]} />
        <div className="spacer" />
        <span className="dim mono" style={{ fontSize: 11.5 }}>{filtered.length} logs</span>
      </div>

      <div className="log-wrap">
        <div className="log-row head">
          <span>时间</span>
          <span>请求ID</span>
          <span>密钥</span>
          <span>渠道</span>
          <span>模型</span>
          <span style={{ textAlign: "right" }}>状态</span>
          <span style={{ textAlign: "right" }}>首字</span>
          <span style={{ textAlign: "right" }}>完成</span>
          <span style={{ textAlign: "right" }}>输入</span>
          <span style={{ textAlign: "right" }}>输出</span>
          <span style={{ textAlign: "right" }}>命中</span>
          <span style={{ textAlign: "right" }}>创建</span>
          <span style={{ textAlign: "right" }}>消费</span>
        </div>
        {pageRows.length === 0 && (
          <div className="empty">无日志 <span className="mono">// no rows</span></div>
        )}
        {pageRows.map((r, i) => {
          const cls = statusClass(r.status);
          const slow = r.latencyMs > 3000;
          const isNew = newIds.has(r.id) || newIds.has(r.ts);
          return (
            <div
              className={`log-row ${r.errorMsg || r.requestDetail ? "has-error" : ""} ${isNew && i === 0 ? "new" : ""}`}
              key={`${r.id}-${r.ts}`}
              onClick={() => {
                if (!r.errorMsg && !r.requestDetail) return;
                setSelectedError(r);
              }}
            >
              <span className="ts">{fmtClockStamp(r.ts)}</span>
              <span className="reqid" title={r.requestId}>{r.requestId ? r.requestId.slice(0, 8) : "—"}</span>
              <span className="key">{r.keyPrefix}</span>
              <span className={`channel ${r.channelType}`}>{r.channelName}</span>
              <span className="model" title={r.inboundModel && r.upstreamModel && r.inboundModel !== r.upstreamModel ? `${r.inboundModel} -> ${r.upstreamModel}` : r.model}>
                {r.inboundModel && r.upstreamModel && r.inboundModel !== r.upstreamModel ? `${r.inboundModel} → ${r.upstreamModel}` : r.model}
              </span>
              <span className={cls} style={{ textAlign: "right" }}>{statusLabel(r.status)}{r.errorMsg || r.requestDetail ? <span className="err-toggle"> 查看</span> : null}</span>
              <span className={`lat ttft ${slow ? "slow" : ""}`}>{r.ttftMs || r.latencyMs || "—"}<span className="dim">ms</span></span>
              <span className={`lat duration ${slow ? "slow" : ""}`}>{r.durationMs > 0 ? <>{r.durationMs}<span className="dim">ms</span></> : <span className="running">进行中</span>}</span>
              <span className="tokens">{r.tokensIn || "—"}</span>
              <span className="tokens">{r.tokensOut || "—"}</span>
              <span className="tokens cache-token">{r.cacheReadTokens || "—"}</span>
              <span className="tokens cache-token create-token">{r.cacheCreationTokens || "—"}</span>
              <span className="tokens">{r.cost > 0 ? `$${r.cost.toFixed(6)}` : "—"}</span>
            </div>
          );
        })}
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />

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
              <pre className="error-detail mono">{errorText(selectedError)}</pre>
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

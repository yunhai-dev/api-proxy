"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useToast } from "@/components/toast";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";
import { formatShanghaiDateTime } from "@/lib/time";
import { rowActionsPosition } from "@/lib/utils";
import { ChannelForm } from "./channel-form";

type Channel = {
  id: string;
  name: string;
  type: "claude" | "openai";
  openAiProtocol: "auto" | "chat_completions" | "responses";
  baseUrl: string;
  weight: number;
  maxConcurrency: number;
  monitorIntervalSec: number;
  testModel: string;
  models: string[];
  status: "ok" | "warn" | "err";
  p50Ms: number;
  errRate: number;
  enabled: boolean;
  capabilities: string[];
};

type EditTarget = "add" | { kind: "edit"; channel: Channel } | null;
type TestLog = { id: number; channelId: string; ts: number; ok: boolean; latencyMs: number; errorMsg: string | null };
const DEFAULT_PAGE_SIZE = 20;

export function ChannelsTable() {
  const toast = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [target, setTarget] = useState<EditTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Channel | null>(null);
  const [historyRows, setHistoryRows] = useState<TestLog[]>([]);
  const [testing, setTesting] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [enabledFilter, setEnabledFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [openActions, setOpenActions] = useState<{ id: string; style: React.CSSProperties } | null>(null);
  const { sortedRows, sortHeader, sort } = useSortableRows(channels, {
    name: row => row.name,
    type: row => row.type,
    baseUrl: row => row.baseUrl,
    models: row => row.models.join(","),
    weight: row => row.weight,
    maxConcurrency: row => row.maxConcurrency,
    monitorIntervalSec: row => row.monitorIntervalSec,
    testModel: row => row.testModel,
    status: row => row.status,
    enabled: row => row.enabled,
  }, "weight", "desc");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), query, type: typeFilter, status: statusFilter, enabled: enabledFilter });
    params.set("sort", sort.key);
    params.set("sortDir", sort.dir);
    try {
      const r = await fetch(`/api/channels?${params}`);
      if (r.ok) {
        const data = await r.json();
        setChannels(data.rows ?? []);
        setTotal(data.total ?? 0);
      }
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [page, pageSize, query, typeFilter, statusFilter, enabledFilter, sort.key, sort.dir]);
  useEffect(() => { setPage(1); }, [query, typeFilter, statusFilter, enabledFilter, sort.key, sort.dir]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  function toggleActions(c: Channel, event: React.MouseEvent<HTMLButtonElement>) {
    if (openActions?.id === c.id) {
      setOpenActions(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenActions({ id: c.id, style: rowActionsPosition(rect) });
  }

  async function testAll() {
    if (testing) return;
    setTesting(true);
    const t0 = Date.now();
    try {
      const r = await fetch("/api/channels/test-all", { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast(data.error || "测试失败"); return; }
      const { tested, summary } = data;
      const ms = Date.now() - t0;
      if (tested === 0) {
        toast("没有启用的渠道可测试");
      } else {
        toast(`已测试 ${tested} 个 · ${summary.reached} 可达 / ${summary.failed} 失败 · 平均 ${summary.avgLatencyMs}ms · 耗时 ${ms}ms`);
      }
      load();
    } finally {
      setTesting(false);
    }
  }

  async function doDelete(c: Channel) {
    const r = await fetch(`/api/channels/${c.id}`, { method: "DELETE" });
    if (r.ok) {
      toast(`已删除渠道 ${c.name}`);
      setDeleteTarget(null);
      load();
    } else {
      const e = await r.json().catch(() => ({}));
      toast(e.error || "删除失败");
    }
  }

  async function test(c: Channel) {
    const r = await fetch(`/api/channels/${c.id}/test`, { method: "POST" });
    const data = await r.json().catch(() => ({}));
    if (data.reachable) {
      toast(`已向 ${c.name} 发送测试请求 · ${data.latencyMs}ms`);
    } else {
      toast(`${c.name} · ${data.error || "失败"}`);
    }
  }

  async function openHistory(c: Channel) {
    setHistoryTarget(c);
    const r = await fetch(`/api/channels/${c.id}/test-logs?limit=50`);
    if (r.ok) setHistoryRows(await r.json());
  }

  async function toggle(c: Channel) {
    const r = await fetch(`/api/channels/${c.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !c.enabled }),
    });
    if (r.ok) {
      toast(c.enabled ? `已停用 ${c.name}` : `已启用 ${c.name}`);
      load();
    }
  }

  return (
    <>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索名称 / 地址 / 模型" />
        <Select value={typeFilter} onChange={setTypeFilter} options={[{ value: "all", label: "全部服务商" }, { value: "claude", label: "Claude" }, { value: "openai", label: "OpenAI" }]} />
        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "ok", label: "正常" }, { value: "warn", label: "限流" }, { value: "err", label: "降级" }]} />
        <Select value={enabledFilter} onChange={setEnabledFilter} options={[{ value: "all", label: "全部启用状态" }, { value: "enabled", label: "已启用" }, { value: "disabled", label: "已停用" }]} />
        <span className="spacer" />
        <button className="btn" onClick={testAll} disabled={testing}>
          {testing ? "测试中…" : "全部测试"}
        </button>
        <button className="btn primary" onClick={() => setTarget("add")}>
          + 添加渠道 <span className="mono kbd">N</span>
        </button>
      </div>

      <ChannelForm trigger={target} onSaved={() => { setTarget(null); load(); }} />

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>删除渠道</h2>
              <button className="modal-close" onClick={() => setDeleteTarget(null)} aria-label="关闭">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">确认删除渠道 <span className="mono">{deleteTarget.name}</span>？</p>
              <p className="confirm-sub">删除后该渠道不再参与转发和健康检查。</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="btn danger" onClick={() => doDelete(deleteTarget)}>删除</button>
            </div>
          </div>
        </div>
      )}

      {historyTarget && (
        <div className="modal-backdrop" onClick={() => setHistoryTarget(null)}>
          <div className="modal channel-history-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>测试历史 · {historyTarget.name}</h2>
              <button className="modal-close" onClick={() => setHistoryTarget(null)} aria-label="关闭">×</button>
            </div>
            <div className="modal-body">
              {historyRows.length === 0 && <div className="empty">暂无测试记录</div>}
              {historyRows.length > 0 && (
                <>
                  <div className="channel-history-summary">
                    <div className="channel-history-stat">
                      <span className="label">总数</span>
                      <strong className="mono">{historyRows.length}</strong>
                    </div>
                    <div className="channel-history-stat ok">
                      <span className="label">成功</span>
                      <strong className="mono">{historyRows.filter(r => r.ok).length}</strong>
                    </div>
                    <div className="channel-history-stat err">
                      <span className="label">失败</span>
                      <strong className="mono">{historyRows.filter(r => !r.ok).length}</strong>
                    </div>
                    <div className="channel-history-stat">
                      <span className="label">平均延迟</span>
                      <strong className="mono">{averageLatencyMs(historyRows)}<small>ms</small></strong>
                    </div>
                  </div>
                  <div className="channel-history-list">
                    {historyRows.map(row => (
                      <div className={`channel-history-row ${row.ok ? "ok" : "err"}`} key={row.id}>
                        <div className="meta">
                          <span className="badge">{row.ok ? "成功" : "失败"}</span>
                          <span className="time mono">{formatShanghaiDateTime(row.ts)}</span>
                          <span className="latency mono">{row.latencyMs || "—"}<small>ms</small></span>
                        </div>
                        <div className="error mono" title={row.errorMsg ?? ""}>
                          {row.errorMsg ? row.errorMsg : row.ok ? "—" : "未知错误"}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setHistoryTarget(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      <div className="table-wrap">
      <table className="table channels-table">
        <thead>
          <tr>
            {sortHeader("name", "名称")}
            {sortHeader("type", "服务商")}
            <th>协议</th>
            {sortHeader("baseUrl", "基础地址", "channel-base-col")}
            {sortHeader("models", "模型", "channel-models-col")}
            {sortHeader("weight", "权重")}
            {sortHeader("maxConcurrency", "并发")}
            {sortHeader("monitorIntervalSec", "监控")}
            {sortHeader("testModel", "测试模型", "channel-test-model-col")}
            {sortHeader("status", "状态")}
            {sortHeader("enabled", "启用")}
            <th className="right channel-actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={12} className="empty"><span className="loading-spinner" aria-label="加载中" /></td></tr>}
          {!loading && channels.length === 0 && (
            <tr><td colSpan={12} className="empty">暂无渠道 <span className="mono dim">// no rows</span></td></tr>
          )}
          {sortedRows.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td><span className={`type-pill ${c.type}`}>{c.type === "claude" ? "Claude" : "OpenAI"}</span></td>
                <td className="mono dim">{c.type === "openai" ? c.openAiProtocol.replace("chat_completions", "chat") : "—"}</td>
                <td className="mono dim channel-base-cell">{c.baseUrl}</td>
                <td>
                  <div className="models" title={c.models.length ? c.models.join("\n") : "未配置"}>
                    {c.models.slice(0, 2).map(m => <span className="model" key={m}>{m}</span>)}
                    {c.models.length > 2 && <span className="model dim">+{c.models.length - 2}</span>}
                    {!c.models.length && <span className="dim mono text-[11px]">未配置</span>}
                  </div>
                </td>
                <td className="mono">{c.weight}</td>
                <td className="mono">{c.maxConcurrency > 0 ? c.maxConcurrency : "不限"}</td>
                <td className="mono">{c.monitorIntervalSec > 0 ? `${c.monitorIntervalSec}s` : "关闭"}</td>
                <td className="mono dim channel-test-model-cell">{c.testModel || "自动"}</td>
                <td>
                  {c.status === "ok"
                    ? <span className="status ok"><span className="dot ok" /><span className="label">正常</span></span>
                    : c.status === "warn"
                    ? <span className="status warn"><span className="dot warn" /><span className="label">限流</span></span>
                    : <span className="status err"><span className="dot err" /><span className="label">降级</span></span>}
                </td>
                <td className="nowrap">
                  <span
                    className={`toggle-label ${c.enabled ? "on" : "off"}`}
                    onClick={() => toggle(c)}
                    title={c.enabled ? "点击停用" : "点击启用"}
                  >
                    <span className="dot" />
                    {c.enabled ? "已启用" : "已停用"}
                  </span>
                </td>
                <td className="right nowrap">
                  <button
                    className="btn sm ghost icon-btn"
                    onClick={event => toggleActions(c, event)}
                    aria-label={`${c.name} 操作`}
                    aria-expanded={openActions?.id === c.id}
                  >
                    <MoreHorizontal />
                  </button>
                  {openActions?.id === c.id && (
                    <div className="row-actions-popover fixed-menu" style={openActions.style}>
                      <button onClick={() => { setOpenActions(null); test(c); }}>测试</button>
                      <button onClick={() => { setOpenActions(null); openHistory(c); }}>历史</button>
                      <button onClick={() => { setOpenActions(null); setTarget({ kind: "edit", channel: c }); }}>编辑</button>
                      <button className="danger" onClick={() => { setOpenActions(null); setDeleteTarget(c); }}>删除</button>
                    </div>
                  )}
                </td>
              </tr>
          ))}
        </tbody>
      </table>
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
    </>
  );
}

function averageLatencyMs(rows: TestLog[]) {
  const samples = rows.filter(row => row.ok && row.latencyMs > 0);
  if (samples.length === 0) return "—";
  const total = samples.reduce((sum, row) => sum + row.latencyMs, 0);
  return Math.round(total / samples.length).toString();
}

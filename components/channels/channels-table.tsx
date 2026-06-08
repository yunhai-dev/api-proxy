"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { ChannelForm } from "./channel-form";

type Channel = {
  id: string;
  name: string;
  type: "claude" | "openai";
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
};

type EditTarget = "add" | { kind: "edit"; channel: Channel } | null;
type TestLog = { id: number; channelId: string; ts: number; ok: boolean; latencyMs: number; errorMsg: string | null };
const pageSize = 20;

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

  async function load() {
    const r = await fetch("/api/channels");
    if (r.ok) setChannels(await r.json());
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [query, typeFilter, statusFilter, enabledFilter]);

  const filteredChannels = channels.filter(c => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [c.name, c.baseUrl, c.testModel, ...c.models].some(value => value.toLowerCase().includes(q));
    const matchesType = typeFilter === "all" || c.type === typeFilter;
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    const matchesEnabled = enabledFilter === "all" || (enabledFilter === "enabled" ? c.enabled : !c.enabled);
    return matchesQuery && matchesType && matchesStatus && matchesEnabled;
  });
  const totalPages = Math.max(1, Math.ceil(filteredChannels.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageChannels = filteredChannels.slice((safePage - 1) * pageSize, safePage * pageSize);

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
      <div className="page-actions">
        <button className="btn" onClick={testAll} disabled={testing}>
          {testing ? "测试中…" : "全部测试"}
        </button>
        <button className="btn primary" onClick={() => setTarget("add")}>
          + 添加渠道 <span className="mono kbd">N</span>
        </button>
      </div>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索名称 / 地址 / 模型" />
        <Select value={typeFilter} onChange={setTypeFilter} options={[{ value: "all", label: "全部服务商" }, { value: "claude", label: "Claude" }, { value: "openai", label: "OpenAI" }]} />
        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "ok", label: "正常" }, { value: "warn", label: "限流" }, { value: "err", label: "降级" }]} />
        <Select value={enabledFilter} onChange={setEnabledFilter} options={[{ value: "all", label: "全部启用状态" }, { value: "enabled", label: "已启用" }, { value: "disabled", label: "已停用" }]} />
        <span className="spacer" />
        <span className="mono dim">{filteredChannels.length} channels</span>
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
                <div className="channel-history-list mono">
                  {historyRows.map(row => (
                    <div className="channel-history-row" key={row.id}>
                      <span>{new Date(row.ts).toLocaleString()}</span>
                      <span className={row.ok ? "ok" : "err"}>{row.ok ? "成功" : "失败"}</span>
                      <span>{row.latencyMs || "—"}ms</span>
                      <span title={row.errorMsg ?? ""}>{row.errorMsg ? row.errorMsg.slice(0, 80) : "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setHistoryTarget(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>服务商</th>
            <th className="channel-base-col">基础地址</th>
            <th className="channel-models-col">模型</th>
            <th>权重</th>
            <th>并发</th>
            <th>监控</th>
            <th className="channel-test-model-col">测试模型</th>
            <th>状态</th>
            <th>启用</th>
            <th className="right channel-actions-col">操作</th>
          </tr>
        </thead>
        <tbody>
          {pageChannels.length === 0 && (
            <tr><td colSpan={11} className="empty">暂无渠道</td></tr>
          )}
          {pageChannels.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td><span className={`type-pill ${c.type}`}>{c.type}</span></td>
                <td className="mono dim channel-base-cell">{c.baseUrl}</td>
                <td>
                  <div className="models">
                    {c.models.slice(0, 2).map(m => <span className="model" key={m}>{m}</span>)}
                    {c.models.length > 2 && <span className="model dim">+{c.models.length - 2}</span>}
                    {!c.models.length && <span className="dim mono" style={{ fontSize: 11 }}>未配置</span>}
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
                  <button className="btn sm ghost" onClick={() => test(c)}>测试</button>
                  <button className="btn sm ghost" onClick={() => openHistory(c)}>历史</button>
                  <button className="btn sm ghost" onClick={() => setTarget({ kind: "edit", channel: c })}>编辑</button>
                  <button className="btn sm ghost danger" onClick={() => setDeleteTarget(c)}>删除</button>
                </td>
              </tr>
          ))}
        </tbody>
      </table>
      <ListPagination page={safePage} pageSize={pageSize} total={filteredChannels.length} onPageChange={setPage} />
    </>
  );
}

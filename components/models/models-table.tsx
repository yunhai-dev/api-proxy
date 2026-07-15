"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";
import { useToast } from "@/components/toast";
import { Checkbox } from "@/components/ui/checkbox";
import { rowActionsPosition } from "@/lib/utils";

type Provider = "claude" | "openai";
const CAPABILITIES = [
  "chat_completions", "responses", "embeddings", "messages", "streaming",
  "tools", "tool_replay", "vision", "reasoning", "structured_output",
];

type ModelRow = {
  provider: Provider;
  id: string;
  catalogId: string;
  displayName: string;
  visible: boolean;
  enabled: boolean;
  configured: boolean;
  capabilities: string[];
};

type Channel = { type: Provider; enabled: boolean; models: string[] };
type Mapping = { provider: Provider; inboundModel: string; upstreamModel: string };
const DEFAULT_PAGE_SIZE = 20;

export function ModelsTable() {
  const toast = useToast();
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [provider, setProvider] = useState<Provider>("claude");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ModelRow | null>(null);
  const [model, setModel] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [visible, setVisible] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [visibleFilter, setVisibleFilter] = useState("all");
  const [enabledFilter, setEnabledFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [providerCounts, setProviderCounts] = useState<{ claude: number; openai: number }>({ claude: 0, openai: 0 });
  const [loading, setLoading] = useState(false);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [openActionsRect, setOpenActionsRect] = useState<React.CSSProperties | null>(null);
  const { sortedRows, sortHeader, sort } = useSortableRows(rows, {
    provider: row => row.provider,
    id: row => row.id,
    displayName: row => row.displayName,
    visible: row => row.visible,
    enabled: row => row.enabled,
    configured: row => row.configured,
  }, "id");

  useEffect(() => { loadSources(); }, []);
  useEffect(() => { load(); }, [page, pageSize, provider, query, visibleFilter, enabledFilter, sourceFilter, sort.key, sort.dir]);
  useEffect(() => { setPage(1); }, [provider, query, visibleFilter, enabledFilter, sourceFilter, sort.key, sort.dir]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), provider, query, visible: visibleFilter, enabled: enabledFilter, source: sourceFilter });
    params.set("sort", sort.key);
    params.set("sortDir", sort.dir);
    try {
      const r = await fetch(`/api/models?${params}`);
      if (r.ok) {
        const data = await r.json();
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
      }
      const allParams = new URLSearchParams({ page: "1", pageSize: "1", query });
      const claudeRes = await fetch(`/api/models?provider=claude&${allParams}`);
      const openaiRes = await fetch(`/api/models?provider=openai&${allParams}`);
      const claudeData = claudeRes.ok ? await claudeRes.json() : { total: 0 };
      const openaiData = openaiRes.ok ? await openaiRes.json() : { total: 0 };
      setProviderCounts({ claude: claudeData.total ?? 0, openai: openaiData.total ?? 0 });
    } finally { setLoading(false); }
  }

  async function loadSources() {
    const [channelsRes, mappingsRes] = await Promise.all([fetch("/api/channels"), fetch("/api/model-mappings")]);
    if (channelsRes.ok) setChannels(await channelsRes.json());
    if (mappingsRes.ok) setMappings(await mappingsRes.json());
  }

  const selectedRows = rows.filter(row => selected.includes(rowKey(row)));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleSelectedRows = rows.filter(row => selected.includes(rowKey(row)));
  const allSelected = rows.length > 0 && visibleSelectedRows.length === rows.length;
  const mappedSources = new Map<string, string[]>();
  for (const mapping of mappings.filter(m => m.provider === provider)) {
    const current = mappedSources.get(mapping.upstreamModel) ?? [];
    if (!current.includes(mapping.inboundModel)) current.push(mapping.inboundModel);
    mappedSources.set(mapping.upstreamModel, current);
  }
  const modelOptions = [...new Set([
    ...channels.filter(c => c.enabled && c.type === provider).flatMap(c => c.models),
    ...mappings.filter(m => m.provider === provider).flatMap(m => [m.inboundModel, m.upstreamModel]),
  ].filter(m => m && m !== "*"))].sort();
  function resetForm() {
    setEditing(null);
    setModel("");
    setDisplayName("");
    setVisible(true);
    setEnabled(true);
    setCapabilities([]);
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function switchProvider(next: Provider) {
    setProvider(next);
    setSelected([]);
  }

  function openEdit(row: ModelRow) {
    setEditing(row);
    setProvider(row.provider);
    setModel(row.id);
    setDisplayName(row.displayName === row.id ? "" : row.displayName);
    setVisible(row.visible);
    setEnabled(row.enabled);
    setCapabilities(row.capabilities ?? []);
    setOpen(true);
  }

  async function save() {
    if (!model.trim()) { toast("请输入模型名称"); return; }
    const body = { provider, model: model.trim(), displayName, visible, enabled, capabilities };
    const r = editing?.catalogId
      ? await fetch(`/api/models/${editing.catalogId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || "保存失败"); return; }
    toast("模型已保存");
    resetForm();
    setOpen(false);
    load();
  }

  async function toggle(row: ModelRow, patch: Partial<Pick<ModelRow, "visible" | "enabled">>) {
    const body = { provider: row.provider, model: row.id, displayName: row.displayName === row.id ? "" : row.displayName, visible: row.visible, enabled: row.enabled, ...patch };
    const r = row.catalogId
      ? await fetch(`/api/models/${row.catalogId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || "更新失败"); return; }
    load();
  }

  async function bulkUpdate(patch: Partial<Pick<ModelRow, "visible" | "enabled">>) {
    if (selectedRows.length === 0) { toast("请选择模型"); return; }
    const results = await Promise.all(selectedRows.map(row => saveRow(row, patch)));
    const failed = results.filter(result => !result.ok);
    if (failed.length) { toast(failed[0].error || "批量更新失败"); return; }
    toast(`已更新 ${results.length} 个模型`);
    setSelected([]);
    load();
  }

  async function saveRow(row: ModelRow, patch: Partial<Pick<ModelRow, "visible" | "enabled">>) {
    const body = { provider: row.provider, model: row.id, displayName: row.displayName === row.id ? "" : row.displayName, visible: row.visible, enabled: row.enabled, ...patch };
    const r = row.catalogId
      ? await fetch(`/api/models/${row.catalogId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, error: data.error as string | undefined };
  }

  async function deleteRow(row: ModelRow) {
    if (!row.catalogId) { toast("自动发现的模型不能直接删除，请从渠道模型列表移除"); return; }
    if (!window.confirm(`删除模型配置 ${row.id}？`)) return;
    const r = await fetch(`/api/models/${row.catalogId}`, { method: "DELETE" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || "删除失败"); return; }
    toast("模型配置已删除");
    setSelected(prev => prev.filter(item => item !== rowKey(row)));
    load();
  }

  function toggleSelected(row: ModelRow) {
    const key = rowKey(row);
    setSelected(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]);
  }

  return (
    <>
      <div className="page-actions">
        <div className="pricing-provider-switch" aria-label="选择服务商">
          <span className="pricing-provider-label">服务商</span>
          <button className={`pricing-provider-option claude ${provider === "claude" ? "active" : ""}`} onClick={() => switchProvider("claude")} type="button">
            <span>Claude</span>
            <small className="mono">共 {providerCounts.claude} 个模型</small>
          </button>
          <button className={`pricing-provider-option openai ${provider === "openai" ? "active" : ""}`} onClick={() => switchProvider("openai")} type="button">
            <span>OpenAI</span>
            <small className="mono">共 {providerCounts.openai} 个模型</small>
          </button>
        </div>
      </div>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型 / 展示名 / 映射来源" />
        <Select value={visibleFilter} onChange={setVisibleFilter} options={[{ value: "all", label: "全部展示状态" }, { value: "visible", label: "已展示" }, { value: "hidden", label: "已隐藏" }]} />
        <Select value={enabledFilter} onChange={setEnabledFilter} options={[{ value: "all", label: "全部启用状态" }, { value: "enabled", label: "已启用" }, { value: "disabled", label: "已停用" }]} />
        <Select value={sourceFilter} onChange={setSourceFilter} options={[{ value: "all", label: "全部来源" }, { value: "configured", label: "手动配置" }, { value: "discovered", label: "自动发现" }]} />
        <span className="spacer" />
        {selectedRows.length > 0 && <span className="hint">已选择 {selectedRows.length} 个</span>}
        <Select
          value=""
          onChange={value => {
            if (!value) return;
            if (value === "show") bulkUpdate({ visible: true });
            if (value === "hide") bulkUpdate({ visible: false });
            if (value === "enable") bulkUpdate({ enabled: true });
            if (value === "disable") bulkUpdate({ enabled: false });
          }}
          disabled={selectedRows.length === 0}
          placeholder="批量操作"
          options={[
            { value: "show", label: "展示" },
            { value: "hide", label: "隐藏" },
            { value: "enable", label: "启用" },
            { value: "disable", label: "停用" },
          ]}
        />
        <button className="btn primary" onClick={openCreate}>+ 添加模型</button>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{editing ? "编辑模型" : "添加模型"}</h2>
              <button className="modal-close" onClick={() => { resetForm(); setOpen(false); }} aria-label="关闭">×</button>
            </div>
            <div className="modal-body">
              <div className="field-row">
                <div className="field">
                  <label>服务商</label>
                  <Select value={provider} onChange={v => setProvider(v as Provider)} disabled={!!editing} options={[{ value: "claude", label: "claude" }, { value: "openai", label: "openai" }]} />
                </div>
                <div className="field">
                  <label>模型名称</label>
                  <Select className="fill-select" editable value={model} onChange={setModel} disabled={!!editing} placeholder="选择或输入模型名称" options={modelOptions.map(m => ({ value: m, label: m }))} />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>展示名称</label>
                  <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="留空则展示模型名称" />
                </div>
              </div>
              <div className="mapping-channel-picker">
                <button type="button" className={visible ? "active" : ""} onClick={() => setVisible(v => !v)}>{visible ? "展示" : "隐藏"}</button>
                <button type="button" className={enabled ? "active" : ""} onClick={() => setEnabled(v => !v)}>{enabled ? "启用" : "停用"}</button>
              </div>
              <fieldset className="model-picker">
                <legend>桥接能力 <span className="dim mono text-[10px] font-normal">仅跨协议路由使用</span></legend>
                <div className="model-custom-list">
                  {CAPABILITIES.map(capability => (
                    <label key={capability} className="chip-removable">
                      <Checkbox
                        checked={capabilities.includes(capability)}
                        onCheckedChange={() => setCapabilities(current => current.includes(capability)
                          ? current.filter(value => value !== capability)
                          : [...current, capability])}
                      />
                      <span className="mono">{capability}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="hint">隐藏只影响模型列表；停用会拒绝调用该模型。模型映射请继续在“映射”页面维护，入站模型和上游模型都会作为独立模型出现在这里。</div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => { resetForm(); setOpen(false); }}>取消</button>
              <button className="btn primary" onClick={save}>保存</button>
            </div>
          </div>
        </div>
      )}

      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="check-cell">
              <button
                type="button"
                className={`check-control ${allSelected ? "checked" : ""}`}
                aria-label="选择全部模型"
                aria-pressed={allSelected}
                onClick={() => setSelected(allSelected ? [] : rows.map(rowKey))}
              />
            </th>
            {sortHeader("provider", "服务商")}
            {sortHeader("id", "模型名称")}
            {sortHeader("displayName", "展示名称")}
            {sortHeader("visible", "是否展示")}
            {sortHeader("enabled", "是否启用")}
            <th className="right">操作</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={7} className="empty"><span className="loading-spinner" aria-label="加载中" /></td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={7} className="empty">暂无匹配模型 <span className="mono dim">// no rows</span></td></tr>}
          {sortedRows.map(row => (
            <tr key={`${row.provider}:${row.id}`}>
              <td className="check-cell">
                <button
                  type="button"
                  className={`check-control ${selected.includes(rowKey(row)) ? "checked" : ""}`}
                  aria-label={`选择 ${row.id}`}
                  aria-pressed={selected.includes(rowKey(row))}
                  onClick={() => toggleSelected(row)}
                />
              </td>
              <td><span className={`type-pill ${row.provider}`}>{row.provider === "claude" ? "Claude" : "OpenAI"}</span></td>
              <td className="mono">
                <ModelName row={row} sources={mappedSources.get(row.id) ?? []} />
              </td>
              <td>{row.displayName}</td>
              <td><button className={`toggle-label ${row.visible ? "on" : "off"}`} onClick={() => toggle(row, { visible: !row.visible })}><span className="dot" />{row.visible ? "展示" : "隐藏"}</button></td>
              <td><button className={`toggle-label ${row.enabled ? "on" : "off"}`} onClick={() => toggle(row, { enabled: !row.enabled })}><span className="dot" />{row.enabled ? "启用" : "停用"}</button></td>
              <td className="right nowrap">
                <button
                  className="btn sm ghost icon-btn"
                  onClick={event => {
                    if (openActionsId === `${row.provider}:${row.id}`) {
                      setOpenActionsId(null);
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    setOpenActionsId(`${row.provider}:${row.id}`);
                    setOpenActionsRect(rowActionsPosition(rect));
                  }}
                  aria-label="操作"
                  aria-expanded={openActionsId === `${row.provider}:${row.id}`}
                >
                  <MoreHorizontal />
                </button>
                {openActionsId === `${row.provider}:${row.id}` && openActionsRect && (
                  <div className="row-actions-popover" style={openActionsRect}>
                    <button onClick={() => { setOpenActionsId(null); openEdit(row); }}>编辑</button>
                    <button className="danger" onClick={() => { setOpenActionsId(null); deleteRow(row); }} disabled={!row.catalogId}>删除</button>
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

function rowKey(row: ModelRow) {
  return `${row.provider}:${row.id}`;
}

function ModelName({ row, sources }: { row: ModelRow; sources: string[] }) {
  if (sources.length > 0) {
    return (
      <span className="model-map-name">
        <span className="dim">{sources.join(", ")}</span>
        <span className="model-map-arrow">→</span>
        <span>{row.id}</span>
        {!row.configured && <span className="dim"> · 自动发现</span>}
      </span>
    );
  }
  return <>{row.id}{!row.configured && <span className="dim"> · 自动发现</span>}</>;
}

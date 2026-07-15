"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";
import { useToast } from "@/components/toast";
import { formatShanghaiDate } from "@/lib/time";
import { rowActionsPosition } from "@/lib/utils";

type Mapping = {
  id: string;
  provider: "claude" | "openai";
  targetProvider: "claude" | "openai";
  inboundModels: string[];
  upstreamModel: string;
  channelIds: string[];
  enabled: boolean;
  createdAt: number;
};

type Channel = {
  id: string;
  name: string;
  type: "claude" | "openai";
  enabled: boolean;
  models: string[];
};
const DEFAULT_PAGE_SIZE = 20;

export function MappingsTable() {
  const toast = useToast();
  const [rows, setRows] = useState<Mapping[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<"claude" | "openai">("claude");
  const [targetProvider, setTargetProvider] = useState<"claude" | "openai">("claude");
  const [inboundModels, setInboundModels] = useState("");
  const [upstreamModel, setUpstreamModel] = useState("");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Mapping | null>(null);
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [openActionsRect, setOpenActionsRect] = useState<React.CSSProperties | null>(null);
  const channelNames = new Map(channels.map(c => [c.id, c.name]));
  const { sortedRows, sortHeader, sort } = useSortableRows(rows, {
    provider: row => row.provider,
    targetProvider: row => row.targetProvider ?? row.provider,
    inboundModel: row => row.inboundModels.join(", "),
    upstreamModel: row => row.upstreamModel,
    channels: row => row.channelIds?.length ? row.channelIds.map(id => channelNames.get(id) ?? id).join(", ") : "全部",
    enabled: row => row.enabled,
    createdAt: row => row.createdAt,
  }, "createdAt", "desc");

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ view: "groups", page: String(page), pageSize: String(pageSize), query, provider: providerFilter, channelId: channelFilter });
    params.set("sort", sort.key);
    params.set("sortDir", sort.dir);
    try {
      const r = await fetch(`/api/model-mappings?${params}`);
      if (r.ok) {
        const data = await r.json();
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
      }
    } finally { setLoading(false); }
  }

  async function loadChannels() {
    const r = await fetch("/api/channels");
    if (r.ok) setChannels(await r.json());
  }

  useEffect(() => { loadChannels(); }, []);
  useEffect(() => { load(); }, [page, pageSize, query, providerFilter, channelFilter, sort.key, sort.dir]);
  useEffect(() => { setPage(1); setSelected([]); }, [query, providerFilter, channelFilter, sort.key, sort.dir]);

  const upstreamModels = [...new Set(channels
    .filter(c => c.enabled && c.type === targetProvider && (channelIds.length === 0 || channelIds.includes(c.id)))
    .flatMap(c => c.models)
    .filter(model => model && model !== "*"))]
    .sort();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const selectedRows = rows.filter(row => selected.includes(row.id));
  const allSelected = rows.length > 0 && rows.every(row => selected.includes(row.id));

  function resetForm() {
    setInboundModels("");
    setUpstreamModel("");
    setChannelIds([]);
    setEditing(null);
    setTargetProvider("claude");
  }

  function openCreate() {
    resetForm();
    setProvider("claude");
    setTargetProvider("claude");
    setOpen(true);
  }

  function openEdit(row: Mapping) {
    setEditing(row);
    setProvider(row.provider);
    setTargetProvider(row.targetProvider ?? row.provider);
    setInboundModels(row.inboundModels.join("\n"));
    setUpstreamModel(row.upstreamModel);
    setChannelIds(row.channelIds ?? []);
    setOpen(true);
  }

  async function save() {
    const inboundList = [...new Set(inboundModels.split(/\n+/).map(x => x.trim()).filter(Boolean))];
    if (inboundList.length === 0) { toast("请输入入站模型"); return; }
    if (!upstreamModel) { toast("请选择上游模型"); return; }
    const r = await fetch(editing ? `/api/model-mappings/${editing.id}` : "/api/model-mappings", {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, targetProvider, inboundModels: inboundList, upstreamModel, channelIds, enabled: editing?.enabled ?? true }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || (editing ? "更新失败" : "创建失败")); return; }
    toast(editing ? "已更新模型映射组" : `已创建包含 ${inboundList.length} 个入站模型的映射组`);
    resetForm();
    setOpen(false);
    load();
  }

  async function remove(row: Mapping) {
    if (!confirm(`确认删除包含 ${row.inboundModels.length} 个入站模型的映射组？`)) return;
    const r = await fetch(`/api/model-mappings/${row.id}`, { method: "DELETE" });
    if (r.ok) {
      toast("已删除模型映射");
      load();
    } else {
      const data = await r.json().catch(() => ({}));
      toast(data.error || "删除失败");
    }
  }

  async function updateMapping(row: Mapping, patch: Partial<Pick<Mapping, "enabled">>) {
    const r = await fetch(`/api/model-mappings/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetProvider: row.targetProvider ?? row.provider, inboundModels: row.inboundModels, upstreamModel: row.upstreamModel, channelIds: row.channelIds ?? [], enabled: row.enabled, ...patch }),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, error: data.error as string | undefined };
  }

  async function toggle(row: Mapping) {
    const result = await updateMapping(row, { enabled: !row.enabled });
    if (!result.ok) { toast(result.error || "更新失败"); return; }
    load();
  }

  async function bulkDelete() {
    if (selectedRows.length === 0 || !confirm(`确认删除选中的 ${selectedRows.length} 组模型映射？`)) return;
    const r = await fetch("/api/model-mappings", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: selectedRows.map(row => row.id) }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || "批量删除失败"); return; }
    toast(`已删除 ${data.groups ?? selectedRows.length} 组模型映射`);
    setSelected([]);
    load();
  }

  async function bulkUpdate(patch: Partial<Pick<Mapping, "enabled">>) {
    if (selectedRows.length === 0) { toast("请选择映射"); return; }
    const results = await Promise.all(selectedRows.map(row => updateMapping(row, patch)));
    const failed = results.filter(result => !result.ok);
    if (failed.length) { toast(failed[0].error || "批量更新失败"); return; }
    toast(`已更新 ${results.length} 组映射`);
    setSelected([]);
    load();
  }

  function toggleSelected(row: Mapping) {
    setSelected(prev => prev.includes(row.id) ? prev.filter(id => id !== row.id) : [...prev, row.id]);
  }

  return (
    <>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索入站 / 上游 / 渠道" />
        <div className="provider-tabs" aria-label="筛选服务商">
          {[
            ["all", "全部"],
            ["claude", "Claude"],
            ["openai", "OpenAI"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`provider-tab ${value} ${providerFilter === value ? "active" : ""}`}
              onClick={() => setProviderFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <Select value={channelFilter} onChange={setChannelFilter} options={[{ value: "all", label: "全部渠道" }, { value: "__all_channels", label: "全渠道映射" }, ...channels.map(c => ({ value: c.id, label: c.name }))]} />
        <span className="spacer" />
        {selectedRows.length > 0 && <span className="hint">已选择 {selectedRows.length} 组</span>}
        <Select
          value=""
          onChange={value => {
            if (!value) return;
            if (value === "enable") bulkUpdate({ enabled: true });
            if (value === "disable") bulkUpdate({ enabled: false });
            if (value === "delete") bulkDelete();
          }}
          disabled={selectedRows.length === 0}
          placeholder="批量操作"
          options={[
            { value: "enable", label: "启用" },
            { value: "disable", label: "停用" },
            { value: "delete", label: "删除" },
          ]}
        />
        <button className="btn primary" onClick={openCreate}>+ 添加映射</button>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{editing ? "编辑模型映射" : "添加模型映射"}</h2>
              <button className="modal-close" onClick={() => { resetForm(); setOpen(false); }} aria-label="关闭">×</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>入站服务商</label>
                <Select
                  value={provider}
                  onChange={v => { setProvider(v as "claude" | "openai"); setUpstreamModel(""); setChannelIds([]); }}
                  disabled={!!editing}
                  options={[{ value: "claude", label: <span className="type-pill claude">Claude</span> }, { value: "openai", label: <span className="type-pill openai">OpenAI</span> }]}
                />
                {editing && <div className="hint">编辑时不修改服务商；如需切换服务商，请删除后重新创建。</div>}
              </div>
              <div className="field">
                <label>上游服务商</label>
                <Select
                  value={targetProvider}
                  onChange={v => { setTargetProvider(v as "claude" | "openai"); setUpstreamModel(""); setChannelIds([]); }}
                  options={[{ value: "claude", label: <span className="type-pill claude">Claude</span> }, { value: "openai", label: <span className="type-pill openai">OpenAI</span> }]}
                />
                <div className="hint">上游服务商不同于入站服务商时，会启用协议转换。</div>
              </div>
              <div className="field">
                <label>绑定渠道</label>
                <div className="mapping-channel-picker">
                  {channels.filter(c => c.enabled && c.type === targetProvider).map(c => (
                    <button
                      type="button"
                      key={c.id}
                      className={channelIds.includes(c.id) ? "active" : ""}
                      onClick={() => setChannelIds(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                    >
                      {c.name}
                    </button>
                  ))}
                  {channels.filter(c => c.enabled && c.type === targetProvider).length === 0 && <span className="hint">没有启用渠道</span>}
                </div>
                <div className="hint">不选表示该上游服务商全部启用渠道。</div>
              </div>
              <div className="field">
                <label>入站模型</label>
                <textarea
                  className="mono"
                  value={inboundModels}
                  onChange={e => setInboundModels(e.target.value)}
                  placeholder={"调用方使用的模型名，每行一个\n例如：claude-sonnet\n例如：sonnet-latest"}
                  rows={5}
                />
                <div className="hint">每行一个入站模型，同组共享上游模型、渠道和状态；另行新建可保留同名模型的独立路由。</div>
              </div>
              <div className="field">
                <label>上游模型</label>
                <Select
                  className="fill-select"
                  value={upstreamModel}
                  onChange={setUpstreamModel}
                  placeholder={upstreamModels.length ? "选择或手动输入上游模型" : "手动输入上游模型"}
                  editable
                  options={upstreamModels.map(model => ({ value: model, label: model }))}
                />
                {upstreamModels.length === 0 && <div className="hint">请先到渠道页配置或拉取该服务商的模型列表。</div>}
              </div>
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
                aria-label="选择全部映射"
                aria-pressed={allSelected}
                onClick={() => setSelected(allSelected ? [] : rows.map(row => row.id))}
              />
            </th>
            {sortHeader("provider", "入站服务商")}
            {sortHeader("inboundModel", "入站模型")}
            {sortHeader("targetProvider", "上游服务商")}
            {sortHeader("upstreamModel", "上游模型")}
            {sortHeader("channels", "绑定渠道")}
            {sortHeader("enabled", "状态")}
            {sortHeader("createdAt", "创建时间")}
            <th className="right">操作</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={9} className="empty"><span className="loading-spinner" aria-label="加载中" /></td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={9} className="empty">暂无匹配映射 <span className="mono dim">// no rows</span></td></tr>}
          {sortedRows.map(row => (
            <tr key={row.id}>
              <td className="check-cell">
                <button
                  type="button"
                  className={`check-control ${selected.includes(row.id) ? "checked" : ""}`}
                  aria-label={`选择 ${row.inboundModels.join(", ")}`}
                  aria-pressed={selected.includes(row.id)}
                  onClick={() => toggleSelected(row)}
                />
              </td>
              <td><span className={`type-pill ${row.provider}`}>{row.provider === "claude" ? "Claude" : "OpenAI"}</span></td>
              <td><div className="model-custom-list">{row.inboundModels.map(model => <span key={model} className="chip-removable mono"><span>{model}</span></span>)}</div></td>
              <td><span className={`type-pill ${row.targetProvider ?? row.provider}`}>{(row.targetProvider ?? row.provider) === "claude" ? "Claude" : "OpenAI"}</span></td>
              <td className="mono">{row.upstreamModel}</td>
              <td className="mono dim" title={row.channelIds?.length ? row.channelIds.map(id => channelNames.get(id) ?? id).join(", ") : "全部渠道"}>
                {row.channelIds?.length ? row.channelIds.map(id => channelNames.get(id) ?? id).join(", ") : "全部"}
              </td>
              <td><button className={`toggle-label ${row.enabled ? "on" : "off"}`} onClick={() => toggle(row)}><span className="dot" />{row.enabled ? "启用" : "停用"}</button></td>
              <td className="mono dim">{formatShanghaiDate(row.createdAt)}</td>
              <td className="right nowrap">
                <button
                  className="btn sm ghost icon-btn"
                  onClick={event => {
                    if (openActionsId === row.id) {
                      setOpenActionsId(null);
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    setOpenActionsId(row.id);
                    setOpenActionsRect(rowActionsPosition(rect));
                  }}
                  aria-label="操作"
                  aria-expanded={openActionsId === row.id}
                >
                  <MoreHorizontal />
                </button>
                {openActionsId === row.id && openActionsRect && (
                  <div className="row-actions-popover" style={openActionsRect}>
                    <button onClick={() => { setOpenActionsId(null); openEdit(row); }}>编辑</button>
                    <button className="danger" onClick={() => { setOpenActionsId(null); remove(row); }}>删除</button>
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

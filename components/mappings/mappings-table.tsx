"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useToast } from "@/components/toast";

type Mapping = {
  id: string;
  provider: "claude" | "openai";
  inboundModel: string;
  upstreamModel: string;
  channelIds: string[];
  createdAt: number;
};

type Channel = {
  id: string;
  name: string;
  type: "claude" | "openai";
  enabled: boolean;
  models: string[];
};
const pageSize = 20;

export function MappingsTable() {
  const toast = useToast();
  const [rows, setRows] = useState<Mapping[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<"claude" | "openai">("claude");
  const [inboundModels, setInboundModels] = useState("");
  const [upstreamModel, setUpstreamModel] = useState("");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Mapping | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [page, setPage] = useState(1);

  async function load() {
    const r = await fetch("/api/model-mappings");
    if (r.ok) setRows(await r.json());
  }

  async function loadChannels() {
    const r = await fetch("/api/channels");
    if (r.ok) setChannels(await r.json());
  }

  useEffect(() => { load(); loadChannels(); }, []);
  useEffect(() => { setPage(1); }, [query, providerFilter, channelFilter]);

  const upstreamModels = [...new Set(channels
    .filter(c => c.enabled && c.type === provider && (channelIds.length === 0 || channelIds.includes(c.id)))
    .flatMap(c => c.models)
    .filter(model => model && model !== "*"))]
    .sort();
  const channelNames = new Map(channels.map(c => [c.id, c.name]));
  const filteredRows = rows.filter(row => {
    const q = query.trim().toLowerCase();
    const boundNames = row.channelIds?.map(id => channelNames.get(id) ?? id) ?? [];
    const matchesQuery = !q || [row.inboundModel, row.upstreamModel, ...boundNames].some(value => value.toLowerCase().includes(q));
    const matchesProvider = providerFilter === "all" || row.provider === providerFilter;
    const matchesChannel = channelFilter === "all" || (channelFilter === "__all_channels" ? !row.channelIds?.length : row.channelIds?.includes(channelFilter));
    return matchesQuery && matchesProvider && matchesChannel;
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  function resetForm() {
    setInboundModels("");
    setUpstreamModel("");
    setChannelIds([]);
    setEditing(null);
    setFailures([]);
  }

  function openCreate() {
    resetForm();
    setProvider("claude");
    setOpen(true);
  }

  function openEdit(row: Mapping) {
    setEditing(row);
    setProvider(row.provider);
    setInboundModels(row.inboundModel);
    setUpstreamModel(row.upstreamModel);
    setChannelIds(row.channelIds ?? []);
    setFailures([]);
    setOpen(true);
  }

  async function save() {
    const inboundList = [...new Set(inboundModels.split(/\n+/).map(x => x.trim()).filter(Boolean))];
    if (inboundList.length === 0) { toast("请输入入站模型"); return; }
    if (!upstreamModel) { toast("请选择上游模型"); return; }

    if (editing) {
      const r = await fetch(`/api/model-mappings/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inboundModel: inboundList[0], upstreamModel, channelIds }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast(data.error || "更新失败"); return; }
      toast("已更新模型映射");
      resetForm();
      setOpen(false);
      load();
      return;
    }

    const results = await Promise.all(inboundList.map(inboundModel => fetch("/api/model-mappings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, inboundModel, upstreamModel, channelIds }),
    }).then(async r => ({ inboundModel, ok: r.ok, data: await r.json().catch(() => ({})) }))));

    const ok = results.filter(r => r.ok).length;
    const failed = results.length - ok;
    const failedRows = results.filter(r => !r.ok).map(r => `${r.inboundModel}: ${r.data?.error || "创建失败"}`);
    setFailures(failedRows);
    if (ok === 0) { toast(results[0]?.data?.error || "创建失败"); return; }
    toast(failed > 0 ? `已创建 ${ok} 条，失败 ${failed} 条` : `已创建 ${ok} 条模型映射`);
    if (failed > 0) {
      setInboundModels(failedRows.map(item => item.split(":")[0]).join("\n"));
      load();
      return;
    }
    resetForm();
    setOpen(false);
    load();
  }

  async function remove(row: Mapping) {
    const r = await fetch(`/api/model-mappings/${row.id}`, { method: "DELETE" });
    if (r.ok) {
      toast("已删除模型映射");
      load();
    } else {
      const data = await r.json().catch(() => ({}));
      toast(data.error || "删除失败");
    }
  }

  return (
    <>
      <div className="page-actions">
        <button className="btn primary" onClick={openCreate}>+ 添加映射</button>
      </div>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索入站 / 上游 / 渠道" />
        <Select value={providerFilter} onChange={setProviderFilter} options={[{ value: "all", label: "全部服务商" }, { value: "claude", label: "Claude" }, { value: "openai", label: "OpenAI" }]} />
        <Select value={channelFilter} onChange={setChannelFilter} options={[{ value: "all", label: "全部渠道" }, { value: "__all_channels", label: "全渠道映射" }, ...channels.map(c => ({ value: c.id, label: c.name }))]} />
        <span className="spacer" />
        <span className="mono dim">{filteredRows.length} mappings</span>
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
                <label>服务商</label>
                <Select
                  value={provider}
                  onChange={v => { setProvider(v as "claude" | "openai"); setUpstreamModel(""); setChannelIds([]); }}
                  disabled={!!editing}
                  options={[{ value: "claude", label: "claude" }, { value: "openai", label: "openai" }]}
                />
                {editing && <div className="hint">编辑时不修改服务商；如需切换服务商，请删除后重新创建。</div>}
              </div>
              <div className="field">
                <label>绑定渠道</label>
                <div className="mapping-channel-picker">
                  {channels.filter(c => c.enabled && c.type === provider).map(c => (
                    <button
                      type="button"
                      key={c.id}
                      className={channelIds.includes(c.id) ? "active" : ""}
                      onClick={() => setChannelIds(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                    >
                      {c.name}
                    </button>
                  ))}
                  {channels.filter(c => c.enabled && c.type === provider).length === 0 && <span className="hint">没有启用渠道</span>}
                </div>
                <div className="hint">不选表示该服务商全部启用渠道。</div>
              </div>
              <div className="field">
                <label>入站模型</label>
                <textarea
                  className="mono"
                  value={inboundModels}
                  onChange={e => setInboundModels(e.target.value)}
                  placeholder={"调用方使用的模型名，每行一个\n例如：claude-sonnet\n例如：sonnet-latest"}
                  rows={editing ? 2 : 5}
                />
                <div className="hint">{editing ? "编辑时只使用第一行。" : "每行创建一条映射，重复行会自动去重。"}</div>
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
              {failures.length > 0 && (
                <div className="mapping-failures mono">
                  {failures.map(item => <div key={item}>{item}</div>)}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => { resetForm(); setOpen(false); }}>取消</button>
              <button className="btn primary" onClick={save}>保存</button>
            </div>
          </div>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>服务商</th>
            <th>入站模型</th>
            <th>上游模型</th>
            <th>绑定渠道</th>
            <th>创建时间</th>
            <th className="right">操作</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.length === 0 && <tr><td colSpan={6} className="empty">暂无匹配映射</td></tr>}
          {pageRows.map(row => (
            <tr key={row.id}>
              <td><span className={`type-pill ${row.provider}`}>{row.provider}</span></td>
              <td className="mono">{row.inboundModel}</td>
              <td className="mono">{row.upstreamModel}</td>
              <td className="mono dim" title={row.channelIds?.length ? row.channelIds.map(id => channelNames.get(id) ?? id).join(", ") : "全部渠道"}>
                {row.channelIds?.length ? row.channelIds.map(id => channelNames.get(id) ?? id).join(", ") : "全部"}
              </td>
              <td className="mono dim">{new Date(row.createdAt).toISOString().slice(0, 10)}</td>
              <td className="right">
                <button className="btn sm ghost" onClick={() => openEdit(row)}>编辑</button>{" "}
                <button className="btn sm ghost danger" onClick={() => remove(row)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ListPagination page={safePage} pageSize={pageSize} total={filteredRows.length} onPageChange={setPage} />
    </>
  );
}

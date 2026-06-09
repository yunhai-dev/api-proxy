"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";

type ModelPrice = {
  id: string;
  provider: "claude" | "openai";
  channelId: string;
  model: string;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  cacheReadPricePerMTok: number;
  cacheCreationPricePerMTok: number;
};

type Channel = { id: string; name: string; type: "claude" | "openai"; enabled: boolean; models: string[] };
type Mapping = { provider: "claude" | "openai"; inboundModel: string; upstreamModel: string };
type CatalogModel = { provider: "claude" | "openai"; id: string; displayName: string };
const pageSize = 20;

export function PricingTable() {
  const toast = useToast();
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [provider, setProvider] = useState<"claude" | "openai">("claude");
  const [channelId, setChannelId] = useState("");
  const [model, setModel] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [cacheRead, setCacheRead] = useState("");
  const [cacheCreation, setCacheCreation] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const { sortedRows, sortHeader, sort } = useSortableRows(prices, {
    provider: row => row.provider,
    channelId: row => row.channelId ?? "",
    model: row => row.model,
    inputPricePerMTok: row => row.inputPricePerMTok,
    outputPricePerMTok: row => row.outputPricePerMTok,
    cacheReadPricePerMTok: row => row.cacheReadPricePerMTok,
    cacheCreationPricePerMTok: row => row.cacheCreationPricePerMTok,
  }, "model");

  useEffect(() => { loadSources(); }, []);
  useEffect(() => { load(); }, [page, query, provider, sort.key, sort.dir]);
  useEffect(() => { setPage(1); }, [query, provider, sort.key, sort.dir]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), query, provider });
    params.set("sort", sort.key);
    params.set("sortDir", sort.dir);
    try {
      const r = await fetch(`/api/model-prices?${params}`);
      if (r.ok) {
        const data = await r.json();
        setPrices(data.rows ?? []);
        setTotal(data.total ?? 0);
      }
    } finally { setLoading(false); }
  }

  async function loadSources() {
    const [channelsRes, mappingsRes, modelsRes] = await Promise.all([fetch("/api/channels"), fetch("/api/model-mappings"), fetch("/api/models")]);
    if (channelsRes.ok) setChannels(await channelsRes.json());
    if (mappingsRes.ok) setMappings(await mappingsRes.json());
    if (modelsRes.ok) setCatalogModels(await modelsRes.json());
  }

  const activeProvider = channelId ? channels.find(c => c.id === channelId)?.type ?? provider : provider;
  const modelOptions = [...new Set([
    ...catalogModels.filter(m => m.provider === activeProvider).map(m => m.id),
    ...(channelId
      ? channels.filter(c => c.id === channelId).flatMap(c => c.models)
      : channels.filter(c => c.enabled && c.type === activeProvider).flatMap(c => c.models)
    ).filter(m => m && m !== "*"),
    ...mappings.filter(m => m.provider === activeProvider).flatMap(m => [m.inboundModel, m.upstreamModel]).filter(Boolean),
  ])].sort();
  const providerCounts = {
    claude: modelOptionsFor("claude").length,
    openai: modelOptionsFor("openai").length,
  };
  const channelNames = new Map(channels.map(c => [c.id, c.name]));
  const existing = prices.find(row => (row.channelId ?? "") === channelId && row.model === model.trim());
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  function modelOptionsFor(nextProvider: "claude" | "openai") {
    return [...new Set([
      ...catalogModels.filter(m => m.provider === nextProvider).map(m => m.id),
      ...channels.filter(c => c.enabled && c.type === nextProvider).flatMap(c => c.models).filter(m => m && m !== "*"),
      ...mappings.filter(m => m.provider === nextProvider).flatMap(m => [m.inboundModel, m.upstreamModel]).filter(Boolean),
    ])].sort();
  }

  async function save() {
    if (!model.trim()) { toast("请输入模型"); return; }
    if (existing) { toast("该模型已配置定价，请先删除旧定价"); return; }
    const r = await fetch("/api/model-prices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: activeProvider,
        channelId,
        model,
        inputPricePerMTok: Number(input) || 0,
        outputPricePerMTok: Number(output) || 0,
        cacheReadPricePerMTok: Number(cacheRead) || 0,
        cacheCreationPricePerMTok: Number(cacheCreation) || 0,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || "保存定价失败"); return; }
    toast("模型定价已保存");
    setModel(""); setInput(""); setOutput(""); setCacheRead(""); setCacheCreation("");
    setOpen(false);
    load();
  }

  async function remove(row: ModelPrice) {
    const r = await fetch(`/api/model-prices/${row.id}`, { method: "DELETE" });
    if (r.ok) { toast("已删除模型定价"); load(); }
  }

  return (
    <>
      <div className="page-actions pricing-actions">
        <div className="pricing-provider-switch" aria-label="选择服务商">
          <span className="pricing-provider-label">服务商</span>
          <button className={`pricing-provider-option claude ${provider === "claude" ? "active" : ""}`} onClick={() => { setProvider("claude"); setChannelId(""); setModel(""); }} type="button">
            <span>Claude</span>
            <small className="mono">{providerCounts.claude} models</small>
          </button>
          <button className={`pricing-provider-option openai ${provider === "openai" ? "active" : ""}`} onClick={() => { setProvider("openai"); setChannelId(""); setModel(""); }} type="button">
            <span>OpenAI</span>
            <small className="mono">{providerCounts.openai} models</small>
          </button>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>+ 添加定价</button>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal pricing-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>添加模型定价</h2>
              <button className="modal-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>渠道</label>
                <Select className="fill-select" value={channelId || "__default"} onChange={v => { setChannelId(v === "__default" ? "" : v); setModel(""); }} options={[{ value: "__default", label: `${provider === "claude" ? "Claude" : "OpenAI"} 默认价` }, ...channels.filter(c => c.type === provider).map(c => ({ value: c.id, label: `${c.name} (${c.type})` }))]} />
              </div>
              <div className="field">
                <label>模型</label>
                <Select className="fill-select" editable value={model} onChange={setModel} placeholder="选择或输入模型 ID" options={modelOptions.map(m => { const used = prices.some(row => (row.channelId ?? "") === channelId && row.model === m); return { value: m, label: m, hint: used ? "已定价" : undefined, disabled: used }; })} />
              </div>
              <div className="field-row">
                <div className="field"><label>输入单价</label><input className="mono" value={input} onChange={e => setInput(e.target.value)} placeholder="$/M Token" /></div>
                <div className="field"><label>输出单价</label><input className="mono" value={output} onChange={e => setOutput(e.target.value)} placeholder="$/M Token" /></div>
              </div>
              <div className="field-row">
                <div className="field"><label>命中缓存</label><input className="mono" value={cacheRead} onChange={e => setCacheRead(e.target.value)} placeholder="$/M Token" /></div>
                <div className="field"><label>创建缓存</label><input className="mono" value={cacheCreation} onChange={e => setCacheCreation(e.target.value)} placeholder="$/M Token" /></div>
              </div>
              {existing && <div className="pricing-error">该渠道下该模型已配置定价，请先删除旧定价后再新增。</div>}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setOpen(false)}>取消</button>
              <button className="btn primary" onClick={save} disabled={!!existing}>保存定价</button>
            </div>
          </div>
        </div>
      )}

      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型定价" />
        <span className="spacer" />
        <span className="mono dim">{loading ? <span className="loading-spinner" aria-label="加载中" /> : `${total} prices`}</span>
      </div>

      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {sortHeader("provider", "服务商")}
            {sortHeader("channelId", "渠道")}
            {sortHeader("model", "模型")}
            {sortHeader("inputPricePerMTok", "输入单价")}
            {sortHeader("outputPricePerMTok", "输出单价")}
            {sortHeader("cacheReadPricePerMTok", "命中缓存")}
            {sortHeader("cacheCreationPricePerMTok", "创建缓存")}
            <th className="right">操作</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="empty"><span className="loading-spinner" aria-label="加载中" /></td></tr>}
          {!loading && prices.length === 0 && <tr><td colSpan={8} className="empty">暂无匹配定价，未配置的模型成本按 0 计算。</td></tr>}
          {sortedRows.map(row => (
            <tr key={row.id}>
              <td><span className={`type-pill ${row.provider}`}>{row.provider}</span></td>
              <td>{row.channelId ? channelNames.get(row.channelId) ?? row.channelId : <span className="dim">默认价</span>}</td>
              <td className="mono">{row.model}</td>
              <td className="mono">${row.inputPricePerMTok}/M Token</td>
              <td className="mono">${row.outputPricePerMTok}/M Token</td>
              <td className="mono">${row.cacheReadPricePerMTok}/M Token</td>
              <td className="mono">${row.cacheCreationPricePerMTok}/M Token</td>
              <td className="right"><button className="btn sm ghost danger" onClick={() => remove(row)}>删除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={total} onPageChange={setPage} />
    </>
  );
}

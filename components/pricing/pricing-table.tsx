"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";

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
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => { load(); loadSources(); }, []);
  useEffect(() => { setPage(1); }, [query, providerFilter]);

  async function load() {
    const r = await fetch("/api/model-prices");
    if (r.ok) setPrices(await r.json());
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
  const filteredPrices = prices.filter(row => {
    const q = query.trim().toLowerCase();
    const channelName = row.channelId ? channelNames.get(row.channelId) ?? row.channelId : "默认价";
    const matchesQuery = !q || row.model.toLowerCase().includes(q) || channelName.toLowerCase().includes(q);
    const matchesProvider = providerFilter === "all" || row.provider === providerFilter;
    return matchesQuery && matchesProvider;
  });
  const totalPages = Math.max(1, Math.ceil(filteredPrices.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagePrices = filteredPrices.slice((safePage - 1) * pageSize, safePage * pageSize);

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
    load();
  }

  async function remove(row: ModelPrice) {
    const r = await fetch(`/api/model-prices/${row.id}`, { method: "DELETE" });
    if (r.ok) { toast("已删除模型定价"); load(); }
  }

  return (
    <>
      <div className="pricing-editor">
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
        <Select
          className="fill-select"
          value={channelId || "__default"}
          onChange={v => { setChannelId(v === "__default" ? "" : v); setModel(""); }}
          options={[{ value: "__default", label: `${provider === "claude" ? "Claude" : "OpenAI"} 默认价` }, ...channels.filter(c => c.type === provider).map(c => ({ value: c.id, label: `${c.name} (${c.type})` }))]}
        />
        <Select
          className="fill-select"
          editable
          value={model}
          onChange={setModel}
          placeholder="选择或输入模型 ID"
          options={modelOptions.map(m => {
            const used = prices.some(row => (row.channelId ?? "") === channelId && row.model === m);
            return { value: m, label: m, hint: used ? "已定价" : undefined, disabled: used };
          })}
        />
        <input className="mono" value={input} onChange={e => setInput(e.target.value)} placeholder="输入 $/M" />
        <input className="mono" value={output} onChange={e => setOutput(e.target.value)} placeholder="输出 $/M" />
        <input className="mono" value={cacheRead} onChange={e => setCacheRead(e.target.value)} placeholder="命中缓存 $/M" />
        <input className="mono" value={cacheCreation} onChange={e => setCacheCreation(e.target.value)} placeholder="创建缓存 $/M" />
        <button className="btn primary" onClick={save} disabled={!!existing}>保存定价</button>
      </div>
      {existing && <div className="pricing-error">该渠道下该模型已配置定价，请先删除旧定价后再新增。</div>}

      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型定价" />
        <Select value={providerFilter} onChange={setProviderFilter} options={[{ value: "all", label: "全部服务商" }, { value: "claude", label: "Claude" }, { value: "openai", label: "OpenAI" }]} />
        <span className="spacer" />
        <span className="mono dim">{filteredPrices.length} prices</span>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>服务商</th>
            <th>渠道</th>
            <th>模型</th>
            <th>输入单价</th>
            <th>输出单价</th>
            <th>命中缓存</th>
            <th>创建缓存</th>
            <th className="right">操作</th>
          </tr>
        </thead>
        <tbody>
          {pagePrices.length === 0 && <tr><td colSpan={8} className="empty">暂无匹配定价，未配置的模型成本按 0 计算。</td></tr>}
          {pagePrices.map(row => (
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
      <ListPagination page={safePage} pageSize={pageSize} total={filteredPrices.length} onPageChange={setPage} />
    </>
  );
}

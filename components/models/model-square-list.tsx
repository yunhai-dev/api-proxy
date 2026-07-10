"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import type { PublicModel } from "@/lib/model-catalog";

type Props = {
  models: PublicModel[];
};

const API_KEY = "sk-relay-XXXX-xxxxxxxxxxxxxxxx";
const DEFAULT_PAGE_SIZE = 12;

function fmtPrice(value: number | null) {
  return value === null ? "未定价" : `$${value}/M`;
}

function hasPrice(model: PublicModel) {
  return model.channelPrices.length > 0 || model.inputPricePerMTok !== null || model.outputPricePerMTok !== null || model.cacheReadPricePerMTok !== null || model.cacheCreationPricePerMTok !== null;
}

function priceSummary(model: PublicModel) {
  if (model.channelPrices.length === 0) return "未定价";
  if (model.channelPrices.length === 1) return model.channelPrices[0].channelName;
  return `${model.channelPrices.length} 个渠道价`;
}

export function ModelSquareList({ models }: Props) {
  const [selected, setSelected] = useState<PublicModel | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [copied, setCopied] = useState("");
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [priceFilter, setPriceFilter] = useState("all");
  const [upstreamFilter, setUpstreamFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  useEffect(() => {
    if (!selected) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);
  useEffect(() => { setPage(1); }, [query, providerFilter, priceFilter, upstreamFilter, models]);

  const filteredModels = models.filter(model => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [model.displayName, model.model, model.upstreamModel].some(value => value.toLowerCase().includes(q));
    const matchesProvider = providerFilter === "all" || model.provider === providerFilter;
    const matchesPrice = priceFilter === "all" || (priceFilter === "priced" ? hasPrice(model) : !hasPrice(model));
    const matchesUpstream = upstreamFilter === "all" || (upstreamFilter === "mapped" ? model.upstreamModel !== model.model : model.upstreamModel === model.model);
    return matchesQuery && matchesProvider && matchesPrice && matchesUpstream;
  });
  const totalPages = Math.max(1, Math.ceil(filteredModels.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageModels = filteredModels.slice((safePage - 1) * pageSize, safePage * pageSize);

  async function copy(label: string, value: string) {
    await navigator.clipboard?.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(""), 1300);
  }

  return (
    <>
      <div className="model-square-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索模型 / 上游模型" />
        <Select value={providerFilter} onChange={setProviderFilter} options={[{ value: "all", label: "全部服务商" }, { value: "claude", label: "Claude" }, { value: "openai", label: "OpenAI" }]} />
        <Select value={priceFilter} onChange={setPriceFilter} options={[{ value: "all", label: "全部定价" }, { value: "priced", label: "已定价" }, { value: "unpriced", label: "未定价" }]} />
        <Select value={upstreamFilter} onChange={setUpstreamFilter} options={[{ value: "all", label: "全部上游" }, { value: "direct", label: "直接上游" }, { value: "mapped", label: "映射上游" }]} />
        <span className="model-square-toolbar-count">{filteredModels.length} 个模型</span>
      </div>
      <div className="model-square-grid">
        {pageModels.length === 0 && <div className="empty">暂无匹配模型 <span className="mono dim">// no rows</span></div>}
        {pageModels.map(model => (
          <button className={`model-square-card ${model.provider}`} key={model.id} onClick={() => setSelected(model)} type="button">
            <div className="model-square-card-top">
              <span className={`type-pill ${model.provider}`}>{model.provider === "claude" ? "Claude" : "OpenAI"}</span>
              <span className="model-square-status"><span />可用</span>
            </div>
            <div className="model-square-card-body">
              <h3>{model.displayName}</h3>
              <div className="model-square-id" aria-label={`模型 ${model.model}`}>{model.model}</div>
              <p>{model.upstreamModel !== model.model ? `映射到 ${model.upstreamModel}` : "直接连接上游模型"}</p>
            </div>
            <div className="model-square-price">
              <div><span>输入</span><strong>{fmtPrice(model.inputPricePerMTok)}</strong></div>
              <div><span>输出</span><strong>{fmtPrice(model.outputPricePerMTok)}</strong></div>
            </div>
            <div className="model-square-card-foot">
              <span>{priceSummary(model)}</span>
              <strong>查看详情 →</strong>
            </div>
          </button>
        ))}
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={filteredModels.length} onPageChange={setPage} onPageSizeChange={setPageSize} />

      {selected && (
        <div className="model-detail-backdrop" onClick={() => setSelected(null)}>
          <section className={`model-detail-panel ${selected.provider}`} onClick={event => event.stopPropagation()} aria-modal="true" role="dialog" aria-labelledby="model-detail-title">
            <div className="model-detail-head">
              <div>
                <span className={`type-pill ${selected.provider}`}>{selected.provider === "claude" ? "Claude" : "OpenAI"}</span>
                <h2 id="model-detail-title">{selected.displayName}</h2>
              </div>
              <button className="model-detail-close" onClick={() => setSelected(null)} type="button" aria-label="关闭模型详情">×</button>
            </div>

            <div className="model-detail-copyline mono">
              <span>{selected.model}</span>
              <button type="button" onClick={() => copy("模型 ID", selected.model)}>{copied === "模型 ID" ? "已复制" : "复制模型 ID"}</button>
            </div>

            <div className="model-detail-facts mono">
              <div><span>Base URL</span><strong>{selected.provider === "openai" ? `${baseUrl}/v1` : baseUrl}</strong></div>
              <div><span>Endpoint</span><strong>{selected.provider === "openai" ? "/v1/chat/completions" : "/v1/messages"}</strong></div>
              <div><span>Upstream</span><strong>{selected.upstreamModel}</strong></div>
              <div><span>输入单价</span><strong>{fmtPrice(selected.inputPricePerMTok)}</strong></div>
              <div><span>输出单价</span><strong>{fmtPrice(selected.outputPricePerMTok)}</strong></div>
              {hasPrice(selected) && <div><span>缓存</span><strong>读 {fmtPrice(selected.cacheReadPricePerMTok)} · 写 {fmtPrice(selected.cacheCreationPricePerMTok)}</strong></div>}
            </div>

            {selected.channelPrices.length > 0 && (
              <div className="model-detail-prices mono">
                {selected.channelPrices.map(price => (
                  <div key={`${price.channelId || "default"}:${selected.model}`}>
                    <span>{price.channelName}</span>
                    <strong>输入 {fmtPrice(price.inputPricePerMTok)} · 输出 {fmtPrice(price.outputPricePerMTok)}</strong>
                  </div>
                ))}
              </div>
            )}

            <ModelSnippet model={selected} baseUrl={baseUrl} copied={copied} onCopy={copy} />

            <div className="model-detail-actions">
              <button className="btn ghost" type="button" onClick={() => copy("Base URL", selected.provider === "openai" ? `${baseUrl}/v1` : baseUrl)}>
                {copied === "Base URL" ? "已复制 Base URL" : "复制 Base URL"}
              </button>
              <Link className="btn primary" href="/docs">查看完整文档</Link>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ModelSnippet({ model, baseUrl, copied, onCopy }: { model: PublicModel; baseUrl: string; copied: string; onCopy: (label: string, value: string) => void }) {
  const snippet = useMemo(() => model.provider === "openai"
    ? `curl -X POST ${baseUrl}/v1/chat/completions \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer ${API_KEY}" \\
  -d '{
    "model": "${model.model}",
    "messages": [{ "role": "user", "content": "hello" }]
  }'`
    : `curl -X POST ${baseUrl}/v1/messages \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer ${API_KEY}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "${model.model}",
    "max_tokens": 512,
    "messages": [{ "role": "user", "content": "hello" }]
  }'`, [baseUrl, model]);

  return (
    <div className="model-detail-snippet">
      <div className="model-detail-snippet-head">
        <span className="mono">curl</span>
        <button type="button" onClick={() => onCopy("调用示例", snippet)}>{copied === "调用示例" ? "已复制" : "复制调用示例"}</button>
      </div>
      <pre className="mono"><code>{snippet}</code></pre>
    </div>
  );
}

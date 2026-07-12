"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const PREDEFINED: Record<"claude" | "openai", string[]> = {
  claude: ["claude-opus-4-7", "claude-sonnet-4-5", "claude-haiku-4-5"],
  openai: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini"],
};

const CAPABILITIES = [
  "chat_completions", "responses", "embeddings", "messages", "streaming",
  "tools", "tool_replay", "vision", "reasoning", "structured_output",
];

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
  capabilities: string[];
};

export function ChannelForm({
  trigger,             // "add" 时不传 / 传 "add"；"edit" 时传整个 channel
  onSaved,
}: {
  trigger?: "add" | { kind: "edit"; channel: Channel } | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"claude" | "openai">("claude");
  const [baseUrl, setBaseUrl] = useState("");
  const [weight, setWeight] = useState("1");
  const [maxConcurrency, setMaxConcurrency] = useState("0");
  const [monitorIntervalSec, setMonitorIntervalSec] = useState("0");
  const [testModel, setTestModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [selectedFetchedModels, setSelectedFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const fetchSeqRef = useRef(0);

  // 由父组件通过 trigger 打开
  useEffect(() => {
    if (!trigger) return;
    resetFetchedModels();
    if (trigger === "add") {
      setEditingId(null);
      setName(""); setType("claude"); setBaseUrl(""); setWeight("1"); setMaxConcurrency("0"); setMonitorIntervalSec("0");
      setApiKey(""); setModels([]); setCapabilities([]); setCustomModel(""); setTestModel("");
      setOpen(true);
    } else if (trigger.kind === "edit") {
      const c = trigger.channel;
      setEditingId(c.id);
      setName(c.name);
      setType(c.type);
      setBaseUrl(c.baseUrl);
      setWeight(String(c.weight));
      setMaxConcurrency(String(c.maxConcurrency ?? 0));
      setMonitorIntervalSec(String(c.monitorIntervalSec ?? 0));
      setTestModel(c.testModel ?? "");
      setApiKey("");            // 不回显密钥，留空保持原值
      setModels(c.models);
      setCapabilities(c.capabilities ?? []);
      setCustomModel("");
      setOpen(true);
    }
  }, [trigger]);

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (fetchedModels !== null) resetFetchedModels();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, fetchedModels]);

  useEffect(() => {
    if (open) resetFetchedModels();
  }, [type, baseUrl, apiKey]);

  function resetFetchedModels() {
    fetchSeqRef.current += 1;
    setFetchedModels(null);
    setSelectedFetchedModels([]);
  }

  function close() { resetFetchedModels(); setOpen(false); }

  function addCustomModel() {
    const m = customModel.trim();
    if (!m || models.includes(m)) return;
    setModels(prev => [...prev, m]);
    setCustomModel("");
  }

  async function submit() {
    if (!name.trim()) { toast("请输入名称"); return; }
    if (!baseUrl.trim()) { toast("请输入基础地址"); return; }
    setBusy(true);
    try {
      const isEdit = !!editingId;
      const payload: Record<string, unknown> = {
        name, type, baseUrl,
        weight: Number(weight) || 1,
        maxConcurrency: Math.max(0, Number(maxConcurrency) || 0),
        monitorIntervalSec: Math.max(0, Number(monitorIntervalSec) || 0),
        testModel,
        models,
        capabilities,
      };
      if (apiKey) payload.apiKey = apiKey; // 仅当用户输入了新密钥

      const r = await fetch(
        isEdit ? `/api/channels/${editingId}` : "/api/channels",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await r.json();
      if (!r.ok) { toast(data.error || "保存失败"); return; }
      toast(isEdit ? `已更新 ${name}` : "渠道已保存。已加入健康检查队列。");
      onSaved();
      close();
    } finally {
      setBusy(false);
    }
  }

  async function fetchModels() {
    if (!baseUrl.trim()) { toast("请输入基础地址"); return; }
    if (!editingId && !apiKey.trim()) { toast("请输入 API 密钥"); return; }
    const seq = ++fetchSeqRef.current;
    setFetchedModels(null);
    setSelectedFetchedModels([]);
    setFetchingModels(true);
    try {
      const r = await fetch("/api/channels/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editingId, type, baseUrl, apiKey }),
      });
      const data = await r.json().catch(() => ({}));
      if (seq !== fetchSeqRef.current) return;
      if (!r.ok) { toast(data.error || "拉取失败"); return; }
      const fetched: string[] = Array.isArray(data.models) ? data.models.filter((m: unknown): m is string => typeof m === "string" && !!m) : [];
      setFetchedModels(fetched);
      setSelectedFetchedModels(fetched.filter(m => models.includes(m)));
      toast(`已拉取 ${fetched.length} 个模型`);
    } finally {
      if (seq === fetchSeqRef.current) setFetchingModels(false);
    }
  }

  function toggleFetchedModel(model: string) {
    setSelectedFetchedModels(prev => prev.includes(model) ? prev.filter(item => item !== model) : [...prev, model]);
  }

  function confirmFetchedModels() {
    setModels(prev => [...prev, ...selectedFetchedModels.filter(model => !prev.includes(model))]);
    resetFetchedModels();
  }

  const isEdit = !!editingId;

  return (
    <>
      {open && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{isEdit ? "编辑渠道" : "添加渠道"}</h2>
              <button className="modal-close" onClick={close} aria-label="关闭">×</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>名称</label>
                <input
                  ref={firstFieldRef}
                  type="text"
                  placeholder="例如：Anthropic 直连"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label>服务商</label>
                  <Select
                    className="fill-select"
                    value={type}
                    onChange={v => { resetFetchedModels(); setType(v as "claude" | "openai"); }}
                    options={[
                      { value: "claude", label: "claude" },
                      { value: "openai", label: "openai" },
                    ]}
                  />
                </div>
                <div className="field" style={{ maxWidth: 110 }}>
                  <label>权重</label>
                  <input
                    type="text"
                    className="mono"
                    placeholder="1"
                    value={weight}
                    onChange={e => setWeight(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <div className="field" style={{ maxWidth: 130 }}>
                  <label>最大并发</label>
                  <input
                    type="text"
                    className="mono"
                    placeholder="0 不限制"
                    value={maxConcurrency}
                    onChange={e => setMaxConcurrency(e.target.value.replace(/\D/g, ""))}
                  />
                  <div className="hint">0 表示不限制。</div>
                </div>
              </div>
              <div className="field-row">
                <div className="field" style={{ maxWidth: 170 }}>
                  <label>定时监控间隔</label>
                  <input
                    type="text"
                    className="mono"
                    placeholder="0 关闭"
                    value={monitorIntervalSec}
                    onChange={e => setMonitorIntervalSec(e.target.value.replace(/\D/g, ""))}
                  />
                  <div className="hint">单位秒，例如 15 表示每 15 秒测试一次。0 表示关闭。</div>
                </div>
                <div className="field">
                  <label>测试模型</label>
                  <Select
                    className="fill-select"
                    value={testModel || "__auto"}
                    onChange={v => setTestModel(v === "__auto" ? "" : v)}
                    options={[
                      { value: "__auto", label: "自动（第一个模型）" },
                      ...models.filter(m => m !== "*").map(m => ({ value: m, label: m })),
                    ]}
                  />
                  <div className="hint">用于渠道健康检查，会发起真实最小模型请求。</div>
                </div>
              </div>
              <div className="field">
                <label>基础地址</label>
                <input
                  type="text"
                  className="mono"
                  placeholder="https://api.anthropic.com"
                  value={baseUrl}
                  onChange={e => { resetFetchedModels(); setBaseUrl(e.target.value); }}
                />
              </div>
              <div className="field">
                <label>API 密钥</label>
                <input
                  type="text"
                  className="mono"
                  placeholder={isEdit ? "留空保持原值" : "sk-…"}
                  value={apiKey}
                  onChange={e => { resetFetchedModels(); setApiKey(e.target.value); }}
                />
                {isEdit && <div className="hint">出于安全，编辑时不回显现有密钥。</div>}
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
              <ModelMultiSelect
                value={models}
                onChange={setModels}
                predefined={PREDEFINED[type]}
                customModel={customModel}
                onCustomModelChange={setCustomModel}
                onAddCustom={addCustomModel}
                onFetchModels={fetchModels}
                fetchingModels={fetchingModels}
                fetchedModels={fetchedModels}
                selectedFetchedModels={selectedFetchedModels}
                onToggleFetchedModel={toggleFetchedModel}
                onConfirmFetchedModels={confirmFetchedModels}
                onCancelFetchedModels={resetFetchedModels}
              />
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={close}>取消</button>
              <button className="btn primary" onClick={submit} disabled={busy}>
                {busy ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ModelMultiSelect({
  value, onChange, predefined,
  customModel, onCustomModelChange, onAddCustom,
  onFetchModels, fetchingModels, fetchedModels, selectedFetchedModels,
  onToggleFetchedModel, onConfirmFetchedModels, onCancelFetchedModels,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  predefined: string[];
  customModel: string;
  onCustomModelChange: (s: string) => void;
  onAddCustom: () => void;
  onFetchModels: () => void;
  fetchingModels: boolean;
  fetchedModels: string[] | null;
  selectedFetchedModels: string[];
  onToggleFetchedModel: (model: string) => void;
  onConfirmFetchedModels: () => void;
  onCancelFetchedModels: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const q = customModel.trim().toLowerCase();
  const filtered = predefined.filter(m => {
    if (value.includes(m)) return false;
    if (!q) return true;
    return m.toLowerCase().includes(q);
  });

  useEffect(() => {
    if (!open) return;
    setHighlight(0);
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  function pick(m: string) {
    onChange([...value, m]);
    onCustomModelChange("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[highlight]) pick(filtered[highlight]);
      else if (customModel.trim()) onAddCustom();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight(h => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showEmpty = open && filtered.length === 0;
  const canAdd = !!customModel.trim();

  return (
    <fieldset className="model-picker">
      <legend>
        模型列表 <span className="dim mono text-[10px] font-normal">已选 {value.length}</span>
      </legend>

      <div className="model-tools">
        <Button type="button" variant="outline" size="sm" onClick={onFetchModels} disabled={fetchingModels}>
          {fetchingModels ? "拉取中…" : "从上游拉取"}
        </Button>
      </div>

      {fetchedModels !== null && (
        <div className="fetched-model-picker">
          <div className="fetched-model-head">
            <span>上游模型</span>
            <span className="dim mono">已勾选 {selectedFetchedModels.length}</span>
          </div>
          {fetchedModels.length === 0 ? (
            <div className="hint">上游未返回可用模型。</div>
          ) : (
            <div className="fetched-model-list">
              {fetchedModels.map(model => {
                const id = `fetched-model-${model}`;
                return (
                  <div className="fetched-model-option" key={model}>
                    <Checkbox id={id} checked={selectedFetchedModels.includes(model)} onCheckedChange={() => onToggleFetchedModel(model)} />
                    <Label htmlFor={id} className="mono">{model}</Label>
                  </div>
                );
              })}
            </div>
          )}
          <div className="fetched-model-actions">
            <Button type="button" variant="ghost" size="sm" onClick={onCancelFetchedModels}>取消</Button>
            <Button type="button" size="sm" onClick={onConfirmFetchedModels} disabled={selectedFetchedModels.length === 0}>确认添加</Button>
          </div>
        </div>
      )}

      <div className="model-add-row" ref={wrapRef}>
        <div className={`combo ${open ? "open" : ""}`}>
          <input
            type="text"
            className="mono"
            placeholder="选择预置或输入自定义 + Enter"
            value={customModel}
            onChange={e => { onCustomModelChange(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="combo-toggle"
            onClick={() => setOpen(o => !o)}
            aria-label="展开预置"
          />
          {open && (
            <div className="combo-menu">
              {showEmpty ? (
                <div className="combo-empty mono">无匹配项，直接按 Enter 添加自定义</div>
              ) : (
                filtered.map((m, i) => (
                  <div
                    key={m}
                    className={`combo-item mono ${i === highlight ? "active" : ""}`}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={e => { e.preventDefault(); pick(m); }}
                  >
                    <span>{m}</span>
                    <span className="dim">predefined</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn sm"
          onClick={() => { if (canAdd) { onAddCustom(); setOpen(false); } }}
          disabled={!canAdd}
        >+ 添加</button>
      </div>

      {value.length > 0 && (
        <div className="model-custom-list">
          {value.map(m => (
            <span key={m} className="chip-removable">
              <span className="mono">{m}</span>
              <button
                type="button"
                aria-label="移除"
                onClick={() => onChange(value.filter(x => x !== m))}
              >×</button>
            </span>
          ))}
        </div>
      )}
    </fieldset>
  );
}

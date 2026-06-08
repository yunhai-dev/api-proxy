"use client";

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { fmtRelativeTime, maskKey, quotaCls, quotaPct } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { KeyForm } from "./key-form";

type Key = {
  id: string;
  name: string;
  userId: string;
  prefix: string;
  fullKey: string;
  channelScope: "all" | "claude" | "openai";
  status: "active" | "disabled";
  quota: number;
  used: number;
  createdAt: number;
  lastUsedAt: number | null;
};
type User = { id: string; username: string; displayName: string };
const pageSize = 20;

function trimNumber(value: number, digits: number) {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function fmtTokenCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const tokens = value * 1_000_000;
  if (tokens < 1_000) return Math.round(tokens).toLocaleString();
  if (tokens < 1_000_000) return `${trimNumber(tokens / 1_000, tokens < 10_000 ? 2 : 1)}K`;
  if (tokens < 1_000_000_000) return `${trimNumber(tokens / 1_000_000, tokens < 10_000_000 ? 2 : 1)}M`;
  return `${trimNumber(tokens / 1_000_000_000, tokens < 10_000_000_000 ? 2 : 1)}B`;
}

export function KeysTable({ mode = "user" }: { mode?: "user" | "admin" }) {
  const toast = useToast();
  const [keys, setKeys] = useState<Key[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("all");
  const [filter, setFilter] = useState<"all" | "active" | "disabled" | "exceeded">("all");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Key | null>(null);
  const [page, setPage] = useState(1);

  async function load() {
    const qs = mode === "admin" && selectedUserId !== "all" ? `?userId=${encodeURIComponent(selectedUserId)}` : "";
    const r = await fetch(`/api/keys${qs}`);
    if (r.ok) setKeys(await r.json());
    if (mode === "admin") {
      const u = await fetch("/api/users");
      if (u.ok) setUsers(await u.json());
    }
  }
  useEffect(() => { load(); }, [mode, selectedUserId]);
  useEffect(() => { setPage(1); }, [selectedUserId, filter, search]);

  const counts = useMemo(() => ({
    all: keys.length,
    active: keys.filter(k => k.status === "active").length,
    disabled: keys.filter(k => k.status === "disabled").length,
    exceeded: keys.filter(k => k.quota > 0 && k.used >= k.quota).length,
  }), [keys]);

  const list = useMemo(() => {
    let l = keys;
    if (filter === "exceeded") l = l.filter(k => k.quota > 0 && k.used >= k.quota);
    else if (filter !== "all") l = l.filter(k => k.status === filter);
    if (search) {
      const s = search.toLowerCase();
      l = l.filter(k => k.name.toLowerCase().includes(s) || k.prefix.toLowerCase().includes(s));
    }
    return l;
  }, [keys, filter, search]);
  const userNames = useMemo(() => new Map(users.map(u => [u.id, `${u.displayName} (${u.username})`])), [users]);
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageList = list.slice((safePage - 1) * pageSize, safePage * pageSize);

  async function toggle(k: Key) {
    const next = k.status === "active" ? "disabled" : "active";
    const r = await fetch(`/api/keys/${k.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (r.ok) {
      toast(`已${next === "active" ? "启用" : "停用"} ${k.name}`);
      load();
    } else {
      const e = await r.json();
      toast(e.error || "操作失败");
    }
  }

  async function updateScope(k: Key, channelScope: string) {
    const r = await fetch(`/api/keys/${k.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelScope }),
    });
    if (r.ok) {
      toast(`已更新 ${k.name} 的渠道范围`);
      load();
    } else {
      const e = await r.json().catch(() => ({}));
      toast(e.error || "更新失败");
    }
  }

  function copy(k: Key) {
    navigator.clipboard?.writeText(k.fullKey);
    toast(`已复制 ${k.prefix}…`);
  }

  async function doDelete(k: Key) {
    const r = await fetch(`/api/keys/${k.id}`, { method: "DELETE" });
    if (r.ok) {
      toast(`已删除密钥 ${k.name}`);
      setDeleteTarget(null);
      load();
    } else {
      const e = await r.json().catch(() => ({}));
      toast(e.error || "删除失败");
    }
  }

  return (
    <>
      <KeyForm allowUserSelect={mode === "admin"} onCreated={() => load()} />

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>删除 API 密钥</h2>
              <button className="modal-close" onClick={() => setDeleteTarget(null)} aria-label="关闭">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">确认删除 API 密钥 <span className="mono">{deleteTarget.name}</span>？</p>
              <p className="confirm-sub">删除后使用该密钥的请求会立即鉴权失败。</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="btn danger" onClick={() => doDelete(deleteTarget)}>删除</button>
            </div>
          </div>
        </div>
      )}

      <div className="filterbar">
        <Input
          tone="search"
          type="text"
          placeholder={mode === "admin" ? "按名称、密钥前缀筛选…" : "按名称、密钥前缀筛选…"}
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
        <div className="chips">
          <button className={`chip ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
            全部 <span className="count">{counts.all}</span>
          </button>
          <button className={`chip ${filter === "active" ? "active" : ""}`} onClick={() => setFilter("active")}>
            活跃 <span className="count">{counts.active}</span>
          </button>
          <button className={`chip ${filter === "disabled" ? "active" : ""}`} onClick={() => setFilter("disabled")}>
            已停用 <span className="count">{counts.disabled}</span>
          </button>
          <button className={`chip ${filter === "exceeded" ? "active" : ""}`} onClick={() => setFilter("exceeded")}>
            配额超限 <span className="count">{counts.exceeded}</span>
          </button>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>密钥</th>
            {mode === "admin" && <th>用户</th>}
            <th>创建时间</th>
            <th>最后使用</th>
            <th>渠道范围</th>
            <th>用量</th>
            <th>状态</th>
            <th className="right">操作</th>
          </tr>
        </thead>
        <tbody>
          {pageList.length === 0 && (
            <tr><td colSpan={mode === "admin" ? 9 : 8} className="empty">无匹配密钥 <span className="mono">// no results</span></td></tr>
          )}
          {pageList.map(k => {
            const pct = quotaPct(k.used, k.quota);
            const qCls = quotaCls(k.used, k.quota);
            return (
              <tr key={k.id}>
                <td>
                  <div>{k.name}</div>
                  {k.status === "disabled" && k.lastUsedAt && (
                    <div className="sub">已于 {fmtRelativeTime(k.lastUsedAt)} 停用</div>
                  )}
                </td>
                <td>
                  <span className="key-cell">
                    <span className="mono">
                      {maskKey(k.prefix)}
                    </span>
                    <button className="copy mono" onClick={() => copy(k)}>复制</button>
                  </span>
                </td>
                {mode === "admin" && <td className="mono dim">{k.userId ? userNames.get(k.userId) ?? k.userId : "—"}</td>}
                <td className="mono dim">{new Date(k.createdAt).toISOString().slice(0, 10)}</td>
                <td className="mono dim">{fmtRelativeTime(k.lastUsedAt)}</td>
                <td className="key-scope-cell">
                  <Select
                    size="sm"
                    className="key-scope-select"
                    value={k.channelScope ?? "all"}
                    onChange={v => updateScope(k, v)}
                    options={[
                      { value: "all", label: "全部" },
                      { value: "claude", label: "Claude" },
                      { value: "openai", label: "OpenAI" },
                    ]}
                  />
                </td>
                <td>
                  <div className="quota">
                    <span className="quota-num">{fmtTokenCount(k.used)}<span className="dim">/{k.quota ? fmtTokenCount(k.quota) : "—"}</span></span>
                    {k.quota > 0 && (
                      <div className="track">
                        <div className={`fill ${qCls}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                </td>
                <td>
                  {k.status === "active"
                    ? <span className="status ok"><span className="dot ok" /><span className="label">活跃</span></span>
                    : <span className="status"><span className="dot off" /><span className="label dim">已停用</span></span>}
                </td>
                <td className="right nowrap">
                  <button className="btn sm ghost" onClick={() => toggle(k)}>
                    {k.status === "active" ? "停用" : "启用"}
                  </button>
                  <button className="btn sm ghost danger" onClick={() => setDeleteTarget(k)}>删除</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ListPagination page={safePage} pageSize={pageSize} total={list.length} onPageChange={setPage} />
    </>
  );
}

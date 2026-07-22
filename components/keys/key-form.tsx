"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Select } from "@/components/ui/select";

type Key = {
  id: string;
  name: string;
  userId: string;
  prefix: string;
  channelScope: "all" | "claude" | "openai" | "tavily";
  channelId: string | null;
  status: "active" | "disabled";
  quota: number;
  used: number;
  createdAt: number;
  lastUsedAt: number | null;
};

type User = { id: string; username: string; displayName: string };
type Channel = { id: string; name: string; type: "claude" | "openai" | "tavily"; enabled: boolean };

export function KeyForm({ onCreated, allowUserSelect = false, inline = false }: { onCreated: (k: Key & { fullKey: string }) => void; allowUserSelect?: boolean; inline?: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [quota, setQuota] = useState("");
  const [channelScope, setChannelScope] = useState("all");
  const [channelId, setChannelId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!allowUserSelect) return;
    fetch("/api/users").then(r => r.ok ? r.json() : []).then(setUsers).catch(() => null);
  }, [allowUserSelect]);

  useEffect(() => {
    if (!allowUserSelect) return;
    fetch("/api/channels").then(r => r.ok ? r.json() : []).then(setChannels).catch(() => null);
  }, [allowUserSelect]);

  async function submit() {
    if (!name.trim()) { toast("请输入名称"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          quota: quota ? Number(quota) : 0,
          channelScope,
          channelId: allowUserSelect ? channelId || null : undefined,
          userId: allowUserSelect ? userId : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) { toast(data.error || "生成失败"); return; }
      toast(`已生成 ${data.prefix}…`);
      onCreated(data);
      setName("");
      setQuota("");
      setChannelScope("all");
      setChannelId("");
      setUserId("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!inline && (
        <div className="page-actions">
          <button className="btn primary" onClick={() => setOpen(o => !o)}>
            + 新建密钥 <span className="mono kbd">N</span>
          </button>
        </div>
      )}
      {inline && (
        <button className="btn primary" onClick={() => setOpen(o => !o)}>
          + 新建密钥 <span className="mono kbd">N</span>
        </button>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>新建 API 密钥</h2>
              <button className="modal-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>名称</label>
                <input
                  type="text"
                  placeholder="例如：移动端生产"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                />
                <div className="hint">仅团队成员可见。</div>
              </div>
              {allowUserSelect && (
                <div className="field-row">
                  <div className="field">
                    <label>归属用户</label>
                    <Select
                      className="fill-select"
                      value={userId || "__none"}
                      onChange={v => setUserId(v === "__none" ? "" : v)}
                      options={[{ value: "__none", label: "默认当前管理员" }, ...users.map(u => ({ value: u.id, label: `${u.displayName} (${u.username})` }))]}
                    />
                  </div>
                </div>
              )}
              <div className="field-row">
                <div className="field">
                  <label>配额 (Token/天)</label>
                  <input
                    type="text"
                    className="mono"
                    placeholder="不限"
                    value={quota}
                    onChange={e => setQuota(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                {allowUserSelect && (
                  <div className="field">
                    <label>允许的渠道</label>
                    <Select
                      value={channelScope}
                      onChange={setChannelScope}
                      options={[
                        { value: "all",    label: "全部" },
                        { value: "claude", label: "Claude" },
                        { value: "openai", label: "OpenAI" },
                        { value: "tavily", label: "Tavily" },
                      ]}
                    />
                  </div>
                )}
              </div>
              {allowUserSelect && <div className="field">
                <label>供应商</label>
                <Select
                  className="fill-select"
                  value={channelId || "__all"}
                  onChange={value => {
                    const next = value === "__all" ? "" : value;
                    setChannelId(next);
                    const channel = channels.find(item => item.id === next);
                    if (channel) setChannelScope(channel.type);
                  }}
                  options={[{ value: "__all", label: "不指定供应商" }, ...channels.filter(channel => channel.enabled).map(channel => ({ value: channel.id, label: `${channel.name} (${channel.type})` }))]}
                />
              </div>}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setOpen(false)}>取消</button>
              <button className="btn primary" onClick={submit} disabled={busy}>
                {busy ? "生成中…" : "生成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

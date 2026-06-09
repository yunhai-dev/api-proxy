"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";

type Me = { id: string; username: string; displayName: string; email: string; role: string; status: string };

export default function AccountPage() {
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/me").then(r => r.ok ? r.json() : null).then(data => {
      if (!data) return;
      setMe(data);
      setDisplayName(data.displayName);
      setEmail(data.email);
    }).catch(() => null);
  }, []);

  async function saveProfile() {
    setBusy(true);
    try {
      const r = await fetch("/api/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName, email }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast(data.error || "保存失败"); return; }
      setMe(data);
      toast("个人信息已更新");
    } finally { setBusy(false); }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) { toast("两次输入的新密码不一致"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/me", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword, confirmPassword }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast(data.error || "修改失败"); return; }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast("密码已修改");
    } finally { setBusy(false); }
  }

  if (!me) return <div className="empty"><span className="loading-spinner" aria-label="加载中" /></div>;

  return (
    <section className="container account-page">
      <div className="section-title">
        <h1>个人信息</h1>
        <p>管理你的账号资料、邮箱和登录密码。</p>
      </div>

      <div className="account-grid">
        <div className="settings-card">
          <h2>账号资料</h2>
          <div className="field"><label>用户名</label><input className="mono" value={me.username} disabled /></div>
          <div className="field"><label>显示名称</label><input value={displayName} onChange={e => setDisplayName(e.target.value)} /></div>
          <div className="field"><label>邮箱</label><input className="mono" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div className="field-row"><div className="field"><label>角色</label><input className="mono" value={me.role} disabled /></div><div className="field"><label>状态</label><input className="mono" value={me.status} disabled /></div></div>
          <button className="btn primary" type="button" disabled={busy} onClick={saveProfile}>保存个人信息</button>
        </div>

        <div className="settings-card">
          <h2>修改密码</h2>
          <div className="field"><label>当前密码</label><input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></div>
          <div className="field"><label>新密码</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少 8 个字符" /></div>
          <div className="field"><label>确认新密码</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" /></div>
          <button className="btn" type="button" disabled={busy} onClick={changePassword}>修改密码</button>
        </div>
      </div>
    </section>
  );
}

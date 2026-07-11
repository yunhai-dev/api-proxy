"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Select } from "@/components/ui/select";

type AppSettings = {
  debugModels: boolean;
  proxyMaxRetries: number;
  proxyRetry429: boolean;
  proxyRetry5xx: boolean;
  proxyRetryNetwork: boolean;
  proxyTreatEmptyOutputAsFailure: boolean;
  fallbackEnabled: boolean;
  fallbackChannelId: string;
  fallbackModel: string;
  recordAllRequestDetails: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  defaultRateLimitRpm: number;
  defaultRateLimitTpm: number;
  defaultMaxConcurrency: number;
  globalBillingMultiplier: number;
  siteUrl: string;
  siteName: string;
  siteLogoUrl: string;
  announcementEnabled: boolean;
  announcementMode: "marquee" | "modal";
  announcementTitle: string;
  announcementHtml: string;
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: "none" | "ssl" | "starttls";
  smtpUser: string;
  smtpPassword: string;
  smtpFromEmail: string;
  smtpFromName: string;
};

type ChannelOption = {
  id: string;
  name: string;
  type: "claude" | "openai";
  enabled: boolean;
  status: string;
  models: string[];
};

type ArchiveType = "request_logs" | "channel_test_logs" | "activities";
type ArchivePreview = { type: ArchiveType; before: number; count: number };

const archiveTypeOptions = [
  { value: "request_logs", label: "请求日志" },
  { value: "channel_test_logs", label: "渠道测试日志" },
  { value: "activities", label: "审计日志" },
];

const announcementModeOptions = [
  { value: "marquee", label: "轮播滚动" },
  { value: "modal", label: "弹窗" },
];

const smtpSecureOptions = [
  { value: "starttls", label: "STARTTLS" },
  { value: "ssl", label: "SSL/TLS" },
  { value: "none", label: "None" },
];

const settingsTabs = [
  { id: "proxy", label: "代理重试" },
  { id: "fallback", label: "Fallback 降级" },
  { id: "requests", label: "请求详情" },
  { id: "maintenance", label: "维护模式" },
  { id: "announcement", label: "公告" },
  { id: "site-mail", label: "网站与邮件" },
  { id: "config", label: "配置导入/导出" },
  { id: "logs", label: "日志归档" },
  { id: "limits", label: "默认用户限制" },
] as const;

type SettingsTabId = typeof settingsTabs[number]["id"];

export function SettingsForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = settingsTabs.some(tab => tab.id === tabParam) ? tabParam as SettingsTabId : "proxy";
  const toast = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [importText, setImportText] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [archiveType, setArchiveType] = useState<ArchiveType>("request_logs");
  const [archiveDate, setArchiveDate] = useState("");
  const [archivePreview, setArchivePreview] = useState<ArchivePreview | null>(null);
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);

  useEffect(() => {
    const nextTab = settingsTabs.some(tab => tab.id === tabParam) ? tabParam as SettingsTabId : "proxy";
    setActiveTab(nextTab);
  }, [tabParam]);

  function switchTab(tab: SettingsTabId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/settings?${params.toString()}`);
    setActiveTab(tab);
  }

  function renderSaveButton() {
    return (
      <div className="settings-card-foot">
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? "保存中…" : "保存设置"}</button>
      </div>
    );
  }

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(setSettings).catch(() => null);
    fetch("/api/channels").then(r => r.json()).then(data => setChannels(Array.isArray(data) ? data : data.rows ?? [])).catch(() => null);
  }, []);

  async function save() {
    if (!settings) return;
    setBusy(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast(data.error || "保存失败"); return; }
      setSettings(data);
      toast("设置已保存");
    } finally {
      setBusy(false);
    }
  }

  async function importConfig() {
    if (!importText.trim()) { toast("请输入配置 JSON"); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(importText); } catch { toast("配置 JSON 格式错误"); return; }
    const r = await fetch("/api/config/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || "导入失败"); return; }
    toast(`已导入 ${data.imported} 项配置`);
    setImportText("");
  }

  async function sendTestEmail() {
    if (!testEmail.trim()) { toast("请输入测试收件邮箱"); return; }
    const r = await fetch("/api/settings/email/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: testEmail }) });
    const data = await r.json().catch(() => ({}));
    toast(r.ok ? "测试邮件已发送" : data.error || "发送失败");
  }

  function archiveBefore() {
    if (!archiveDate) return null;
    const value = new Date(`${archiveDate}T00:00:00`).getTime();
    return Number.isFinite(value) ? value : null;
  }

  function archiveUrl() {
    const before = archiveBefore();
    return before ? `/api/export?type=${archiveType}&format=csv&before=${before}` : `/api/export?type=${archiveType}&format=csv`;
  }

  async function previewArchive() {
    const before = archiveBefore();
    if (!before) { toast("请选择截止日期"); return; }
    setArchiveBusy(true);
    try {
      const params = new URLSearchParams({ type: archiveType, before: String(before) });
      const r = await fetch(`/api/settings/archive?${params}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast(data.error || "预览失败"); return; }
      setArchivePreview(data);
      setArchiveConfirmed(false);
      toast(`将清理 ${data.count ?? 0} 条数据`);
    } finally {
      setArchiveBusy(false);
    }
  }

  async function deleteArchive() {
    const before = archiveBefore();
    if (!before || !archivePreview) { toast("请先预览清理数量"); return; }
    if (!archiveConfirmed) { toast("请先确认已下载归档"); return; }
    if (!confirm(`确认删除 ${archivePreview.count} 条旧数据？此操作不可恢复。`)) return;
    setArchiveBusy(true);
    try {
      const r = await fetch("/api/settings/archive", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: archiveType, before, archiveConfirmed, confirm: "DELETE" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast(data.error || "删除失败"); return; }
      toast(`已删除 ${data.deleted ?? 0} 条旧数据`);
      setArchivePreview(null);
      setArchiveConfirmed(false);
    } finally {
      setArchiveBusy(false);
    }
  }

  if (!settings) return <div className="empty"><span className="loading-spinner" aria-label="加载中" /></div>;

  const fallbackChannel = channels.find(channel => channel.id === settings.fallbackChannelId);
  const fallbackModelOptions = fallbackChannel?.models.map(model => ({ value: model, label: model })) ?? [];
  const archiveReady = !!archivePreview && archivePreview.type === archiveType && archivePreview.before === archiveBefore();

  return (
    <div className="settings-panel">
      <div className="settings-tabs" role="tablist" aria-label="系统设置分类">
        {settingsTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`settings-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => switchTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-grid">
        <div className="settings-card" hidden={activeTab !== "proxy"}>
          <h2>代理重试</h2>
          <div className="field">
            <label>最大重试次数</label>
            <input
              className="mono"
              type="text"
              value={settings.proxyMaxRetries}
              onChange={e => setSettings({ ...settings, proxyMaxRetries: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })}
            />
            <div className="hint">每次请求最多尝试的渠道数量。</div>
          </div>
          <Toggle label="重试 429" hint="上游限流时尝试其他候选渠道。" checked={settings.proxyRetry429} onChange={proxyRetry429 => setSettings({ ...settings, proxyRetry429 })} />
          <Toggle label="重试 5xx" hint="上游服务端错误时尝试其他候选渠道。" checked={settings.proxyRetry5xx} onChange={proxyRetry5xx => setSettings({ ...settings, proxyRetry5xx })} />
          <Toggle label="重试网络错误" hint="连接失败、超时等网络错误时尝试其他候选渠道。" checked={settings.proxyRetryNetwork} onChange={proxyRetryNetwork => setSettings({ ...settings, proxyRetryNetwork })} />
          <Toggle label="空输出视为失败" hint="上游返回 200 但没有可见输出且 usage 输出 token 为 0 时，按网络失败重试/降级；缺少 usage 时不会误判。" checked={settings.proxyTreatEmptyOutputAsFailure} onChange={proxyTreatEmptyOutputAsFailure => setSettings({ ...settings, proxyTreatEmptyOutputAsFailure })} />
          <div className="settings-card-foot">
            <button className="btn primary" onClick={save} disabled={busy}>{busy ? "保存中…" : "保存设置"}</button>
          </div>
        </div>

        <div className="settings-card" hidden={activeTab !== "fallback"}>
          <h2>Fallback 降级</h2>
          <Toggle label="启用 Fallback" hint="常规渠道不可用或全部重试失败后，最后尝试指定渠道和模型。不是模型映射。" checked={settings.fallbackEnabled} onChange={fallbackEnabled => setSettings({ ...settings, fallbackEnabled })} />
          <div className="field">
            <label>Fallback 渠道</label>
            <Select
              className="fill-select"
              value={settings.fallbackChannelId || "__none"}
              onChange={fallbackChannelId => setSettings({ ...settings, fallbackChannelId: fallbackChannelId === "__none" ? "" : fallbackChannelId })}
              options={[
                { value: "__none", label: "不使用 Fallback" },
                ...channels.map(channel => ({
                  value: channel.id,
                  label: `${channel.name} (${channel.type})`,
                  hint: `${channel.enabled ? "启用" : "停用"} / ${channel.status}`,
                })),
              ]}
            />
            <div className="hint">请求会重新转换到该渠道协议；停用渠道不会被代理使用。</div>
          </div>
          <div className="field">
            <label>Fallback 模型</label>
            <Select
              className="fill-select"
              editable
              value={settings.fallbackModel}
              onChange={fallbackModel => setSettings({ ...settings, fallbackModel })}
              options={fallbackModelOptions}
              placeholder="例如 claude-sonnet-4-5 或 gpt-5-mini"
            />
            <div className="hint">允许手动输入。该模型仅在触发 fallback 时替换请求模型。</div>
          </div>
          {renderSaveButton()}
        </div>

        <div className="settings-card" hidden={activeTab !== "requests"}>
          <h2>请求详情</h2>
          <Toggle label="保留所有请求详情" hint="开启后成功请求也会记录脱敏请求头、原始完整请求/响应内容、模型、渠道和 token 信息。" checked={settings.recordAllRequestDetails} onChange={recordAllRequestDetails => setSettings({ ...settings, recordAllRequestDetails })} />
          {renderSaveButton()}
        </div>

        <div className="settings-card" hidden={activeTab !== "maintenance"}>
          <h2>维护模式</h2>
          <Toggle label="启用维护模式" hint="开启后所有模型请求都会返回错误，不再访问上游。" checked={settings.maintenanceMode} onChange={maintenanceMode => setSettings({ ...settings, maintenanceMode })} />
          <div className="field">
            <label>维护消息</label>
            <textarea className="mono" value={settings.maintenanceMessage} onChange={e => setSettings({ ...settings, maintenanceMessage: e.target.value })} />
          </div>
          {renderSaveButton()}
        </div>

        <div className="settings-card settings-announcement-card wide" hidden={activeTab !== "announcement"}>
          <h2>公告</h2>
          <Toggle label="启用公告" hint="开启后在用户后台展示公告，可选择滚动公告或弹窗公告。" checked={settings.announcementEnabled} onChange={announcementEnabled => setSettings({ ...settings, announcementEnabled })} />
          <div className="field-row">
            <div className="field"><label>展示方式</label><Select className="fill-select" value={settings.announcementMode} onChange={announcementMode => setSettings({ ...settings, announcementMode: announcementMode as AppSettings["announcementMode"] })} options={announcementModeOptions} /></div>
            <div className="field"><label>标题</label><input value={settings.announcementTitle} onChange={e => setSettings({ ...settings, announcementTitle: e.target.value })} placeholder="公告" /></div>
          </div>
          <div className="field">
            <label>公告 HTML</label>
            <textarea className="mono announcement-editor" value={settings.announcementHtml} onChange={e => setSettings({ ...settings, announcementHtml: e.target.value })} placeholder="例如：<strong>维护通知</strong>：今晚 23:00 将进行系统升级。" />
            <div className="hint">支持基础 HTML。系统会移除 script、iframe、事件属性和 javascript 链接。</div>
          </div>
          {renderSaveButton()}
        </div>

        <div className="settings-card settings-mail-card" hidden={activeTab !== "site-mail"}>
          <h2>网站与邮件</h2>
          <div className="field"><label>网站名称</label><input value={settings.siteName} onChange={e => setSettings({ ...settings, siteName: e.target.value })} /></div>
          <div className="field"><label>网站地址</label><input className="mono" value={settings.siteUrl} onChange={e => setSettings({ ...settings, siteUrl: e.target.value })} placeholder="https://example.com" /></div>
          <div className="field"><label>网站 Logo URL</label><input className="mono" value={settings.siteLogoUrl} onChange={e => setSettings({ ...settings, siteLogoUrl: e.target.value })} placeholder="https://example.com/logo.svg" /><div className="hint">用于顶部品牌和浏览器标签页图标；留空使用默认圆点。</div></div>
          <Toggle label="启用 SMTP" hint="注册邮箱验证会通过该 SMTP 发送验证码和验证链接。" checked={settings.smtpEnabled} onChange={smtpEnabled => setSettings({ ...settings, smtpEnabled })} />
          <div className="field-row"><div className="field"><label>SMTP Host</label><input className="mono" value={settings.smtpHost} onChange={e => setSettings({ ...settings, smtpHost: e.target.value })} /></div><div className="field"><label>端口</label><input className="mono" value={settings.smtpPort} onChange={e => setSettings({ ...settings, smtpPort: Number(e.target.value.replace(/\D/g, "")) || 587 })} /></div></div>
          <div className="field-row"><div className="field"><label>加密方式</label><Select className="fill-select" value={settings.smtpSecure} onChange={smtpSecure => setSettings({ ...settings, smtpSecure: smtpSecure as AppSettings["smtpSecure"] })} options={smtpSecureOptions} /></div><div className="field"><label>SMTP 用户</label><input className="mono" value={settings.smtpUser} onChange={e => setSettings({ ...settings, smtpUser: e.target.value })} /></div></div>
          <div className="field"><label>SMTP 密码 / 授权码</label><input className="mono" type="password" value={settings.smtpPassword === "__configured__" ? "" : settings.smtpPassword} placeholder={settings.smtpPassword === "__configured__" ? "已配置，留空不修改" : ""} onChange={e => setSettings({ ...settings, smtpPassword: e.target.value })} /></div>
          <div className="field-row"><div className="field"><label>发件邮箱</label><input className="mono" value={settings.smtpFromEmail} onChange={e => setSettings({ ...settings, smtpFromEmail: e.target.value })} /></div><div className="field"><label>发件名称</label><input value={settings.smtpFromName} onChange={e => setSettings({ ...settings, smtpFromName: e.target.value })} /></div></div>
          <div className="field-row"><div className="field"><label>测试收件邮箱</label><input className="mono" value={testEmail} onChange={e => setTestEmail(e.target.value)} /></div><div className="field"><label>&nbsp;</label><button className="btn" type="button" onClick={sendTestEmail}>发送测试邮件</button></div></div>
          {renderSaveButton()}
        </div>

        <div className="settings-card" hidden={activeTab !== "config"}>
          <h2>配置导入/导出</h2>
          <div className="page-actions" style={{ margin: 0 }}>
            <a className="btn" href="/api/config/export" target="_blank">导出配置</a>
          </div>
          <div className="field">
            <label>导入配置 JSON</label>
            <textarea className="mono" value={importText} onChange={e => setImportText(e.target.value)} placeholder="粘贴 /api/config/export 的 JSON，可恢复渠道、映射、定价和设置。脱敏导出的密钥不会恢复。" />
          </div>
          <button className="btn" type="button" onClick={importConfig}>导入配置</button>
          {renderSaveButton()}
        </div>

        <div className="settings-card" hidden={activeTab !== "logs"}>
          <h2>日志导出与清理</h2>
          <div className="archive-panel">
            <div className="archive-panel-head">
              <div>
                <h3>直接导出</h3>
                <p>导出完整 CSV，不会删除任何数据。</p>
              </div>
            </div>
            <div className="page-actions settings-export-actions">
              <a className="btn" href="/api/export?type=request_logs&format=csv" target="_blank">请求日志 CSV</a>
              <a className="btn" href="/api/export?type=channel_test_logs&format=csv" target="_blank">渠道测试 CSV</a>
              <a className="btn" href="/api/export?type=activities&format=csv" target="_blank">审计日志 CSV</a>
            </div>
          </div>

          <div className="archive-panel danger-zone">
            <div className="archive-panel-head">
              <div>
                <h3>归档并清理旧数据</h3>
                <p>先按截止日期下载归档，再手动确认删除旧记录。</p>
              </div>
            </div>
            <div className="field-row archive-fields">
              <div className="field">
                <label>清理类型</label>
                <Select className="fill-select" value={archiveType} onChange={value => { setArchiveType(value as ArchiveType); setArchivePreview(null); setArchiveConfirmed(false); }} options={archiveTypeOptions} />
              </div>
              <div className="field">
                <label>删除早于此日期的数据</label>
                <input className="mono" type="date" value={archiveDate} onChange={e => { setArchiveDate(e.target.value); setArchivePreview(null); setArchiveConfirmed(false); }} />
              </div>
            </div>
            <div className="archive-actions">
              <button className="btn" type="button" onClick={previewArchive} disabled={archiveBusy}>{archiveBusy ? "处理中…" : "预览数量"}</button>
              <a className={`btn ${archiveBefore() ? "" : "disabled"}`} href={archiveUrl()} target="_blank" aria-disabled={!archiveBefore()}>下载归档 CSV</a>
              {archivePreview && <span className="archive-count mono">将清理 {archivePreview.count.toLocaleString()} 条</span>}
            </div>
            <label className="archive-confirm">
              <input type="checkbox" checked={archiveConfirmed} onChange={e => setArchiveConfirmed(e.target.checked)} disabled={!archiveReady} />
              <span>我已下载并保存归档文件，确认可以删除旧数据。</span>
            </label>
            <div className="archive-delete-row">
              <button className="btn danger" type="button" onClick={deleteArchive} disabled={!archiveReady || !archiveConfirmed || archiveBusy}>删除旧数据</button>
              <span className="hint">删除后无法从数据库恢复。</span>
            </div>
          </div>
        </div>

        <div className="settings-card" hidden={activeTab !== "limits"}>
          <h2>默认用户限制</h2>
          <div className="field-row"><div className="field"><LabelHelp label="默认 RPM" help="Requests Per Minute，每分钟最多允许的请求次数。" /><input className="mono" value={settings.defaultRateLimitRpm || ""} placeholder="不限" onChange={e => setSettings({ ...settings, defaultRateLimitRpm: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div><div className="field"><LabelHelp label="默认 TPM" help="Tokens Per Minute，每分钟最多允许消耗的输入与输出 Token 总数。" /><input className="mono" value={settings.defaultRateLimitTpm || ""} placeholder="不限" onChange={e => setSettings({ ...settings, defaultRateLimitTpm: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div></div>
          <div className="field"><LabelHelp label="默认最大并发" help="同一用户同一时间最多允许多少个请求正在运行。" /><input className="mono" value={settings.defaultMaxConcurrency || ""} placeholder="不限" onChange={e => setSettings({ ...settings, defaultMaxConcurrency: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
          <div className="field"><LabelHelp label="全局计费倍率" help="按模型定价计算出的费用会统一乘以该倍率，影响费用展示和用户额度扣减。" /><input className="mono" value={settings.globalBillingMultiplier} placeholder="1" onChange={e => setSettings({ ...settings, globalBillingMultiplier: Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0) })} /></div>
          <div className="hint">用户未单独配置这些限制时使用这里的默认值；填空或 0 表示不限制。</div>
          {renderSaveButton()}
        </div>
      </div>
    </div>
  );
}

function LabelHelp({ label, help }: { label: string; help: string }) {
  return (
    <label className="label-help">
      <span>{label}</span>
      <span className="help-dot" tabIndex={0} aria-label={help}>?</span>
      <span className="help-tip">{help}</span>
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="settings-toggle">
      <div>
        <div className="settings-toggle-label">{label}</div>
        <div className="hint">{hint}</div>
      </div>
      <span className="settings-toggle-spacer" aria-hidden="true" />
      <button className={`toggle-label ${checked ? "on" : "off"}`} type="button" onClick={() => onChange(!checked)}>
        <span className="dot" />{checked ? "开启" : "关闭"}
      </button>
    </div>
  );
}

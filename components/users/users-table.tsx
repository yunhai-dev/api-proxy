"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";
import { useToast } from "@/components/toast";
import { formatShanghaiDate } from "@/lib/time";
import { rowActionsPosition } from "@/lib/utils";

type Role = "super_admin" | "admin" | "user";
type User = { id: string; username: string; displayName: string; email: string; role: Role; status: "pending" | "active" | "disabled"; createdAt: number; updatedAt: number; quotaUsd: number; usedUsd: number };
type UserQuota = { quotaUsd: number; usedUsd: number; rateLimitRpm: number; rateLimitTpm: number; maxConcurrency: number };

const roleOptions = [
  { value: "super_admin", label: "超级管理员" },
  { value: "admin", label: "管理员" },
  { value: "user", label: "用户" },
];

const DEFAULT_PAGE_SIZE = 20;

function fmtUsd(value: number) {
  return `$${value.toFixed(4)}`;
}

function userBalance(row: User) {
  return Math.max(0, row.quotaUsd - row.usedUsd);
}

export function UsersTable() {
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [quotaTarget, setQuotaTarget] = useState<User | null>(null);
  const [quota, setQuota] = useState<UserQuota | null>(null);
  const [quotaDeltaMode, setQuotaDeltaMode] = useState("increase");
  const [quotaDelta, setQuotaDelta] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [openActionsRect, setOpenActionsRect] = useState<React.CSSProperties | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const { sortedRows, sortHeader, sort } = useSortableRows(rows, {
    username: row => row.username,
    displayName: row => row.displayName,
    email: row => row.email,
    balance: row => userBalance(row),
    role: row => row.role,
    status: row => row.status,
    createdAt: row => row.createdAt,
  }, "username");

  useEffect(() => { load(); }, [page, pageSize, query, roleFilter, statusFilter, sort.key, sort.dir]);
  useEffect(() => { setPage(1); }, [query, roleFilter, statusFilter, sort.key, sort.dir]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), query, role: roleFilter, status: statusFilter });
    params.set("sort", sort.key);
    params.set("sortDir", sort.dir);
    try {
      const r = await fetch(`/api/users?${params}`);
      if (r.ok) {
        const data = await r.json();
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
      }
    } finally { setLoading(false); }
  }

  async function create() {
    const r = await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, displayName, email, password, role }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || "创建失败"); return; }
    toast("用户已创建");
    setUsername(""); setDisplayName(""); setEmail(""); setPassword(""); setRole("user"); setOpen(false); load();
  }

  async function patch(row: User, body: Partial<User>) {
    const r = await fetch(`/api/users/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { toast("用户已更新"); load(); }
  }

  async function remove(row: User) {
    const r = await fetch(`/api/users/${row.id}`, { method: "DELETE" });
    if (r.ok) { toast("用户已删除"); setDeleteTarget(null); load(); }
    else { const data = await r.json().catch(() => ({})); toast(data.error || "删除失败"); }
  }

  async function openQuota(row: User) {
    setQuotaTarget(row);
    setQuotaDeltaMode("increase");
    setQuotaDelta("");
    const r = await fetch(`/api/users/${row.id}/quota`);
    if (r.ok) setQuota(await r.json());
  }

  async function saveQuota() {
    if (!quotaTarget || !quota) return;
    const delta = quotaDelta.trim() ? Number(quotaDelta) : 0;
    if (quotaDelta.trim() && (!Number.isFinite(delta) || delta <= 0)) { toast("请输入有效的调整金额"); return; }
    const quotaUsd = quotaDeltaMode === "decrease" ? Math.max(0, quota.quotaUsd - delta) : quota.quotaUsd + delta;
    const r = await fetch(`/api/users/${quotaTarget.id}/quota`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...quota, quotaUsd }) });
    if (r.ok) { toast("额度已更新"); setQuotaTarget(null); setQuota(null); setQuotaDelta(""); load(); }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  return (
    <>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索用户名 / 显示名 / 邮箱" />
        <Select value={roleFilter} onChange={setRoleFilter} options={[{ value: "all", label: "全部角色" }, ...roleOptions]} />
        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "pending", label: "待验证" }, { value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} />
        <span className="spacer" />
        <button className="btn primary" onClick={() => setOpen(true)}>+ 新建用户</button>
      </div>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>新建用户</h2><button className="modal-close" onClick={() => setOpen(false)}>×</button></div>
            <div className="modal-body">
              <div className="field"><label>用户名</label><input className="mono" value={username} onChange={e => setUsername(e.target.value)} /></div>
              <div className="field"><label>显示名称</label><input value={displayName} onChange={e => setDisplayName(e.target.value)} /></div>
              <div className="field"><label>邮箱</label><input className="mono" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></div>
              <div className="field">
                <label>初始密码</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 8 个字符，留空则需走邮件验证" />
                <div className="hint">设置后用户可立即用此密码登录。</div>
              </div>
              <div className="field"><label>角色</label><Select className="fill-select" value={role} onChange={v => setRole(v as Role)} options={roleOptions} /></div>
            </div>
            <div className="modal-foot"><button className="btn ghost" onClick={() => setOpen(false)}>取消</button><button className="btn primary" onClick={create}>创建</button></div>
          </div>
        </div>
      )}

      {quotaTarget && quota && (
        <div className="modal-backdrop" onClick={() => setQuotaTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>用户额度 · {quotaTarget.displayName}</h2><button className="modal-close" onClick={() => setQuotaTarget(null)}>×</button></div>
            <div className="modal-body">
              <div className="field-row"><div className="field"><label>当前额度 ($)</label><input className="mono" value={quota.quotaUsd.toFixed(4)} disabled /></div><div className="field"><label>调整方式</label><Select className="fill-select" value={quotaDeltaMode} onChange={setQuotaDeltaMode} options={[{ value: "increase", label: "增加额度" }, { value: "decrease", label: "减少额度" }]} /></div><div className="field"><label>调整金额 ($)</label><input className="mono" value={quotaDelta} placeholder="不调整" onChange={e => setQuotaDelta(e.target.value.replace(/[^\d.]/g, ""))} /></div></div>
              <div className="hint mono">调整后额度：${(quotaDeltaMode === "decrease" ? Math.max(0, quota.quotaUsd - (Number(quotaDelta) || 0)) : quota.quotaUsd + (Number(quotaDelta) || 0)).toFixed(4)}</div>
              <div className="field-row"><div className="field"><label>RPM</label><input className="mono" value={quota.rateLimitRpm || ""} placeholder="使用系统默认" onChange={e => setQuota({ ...quota, rateLimitRpm: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div><div className="field"><label>TPM</label><input className="mono" value={quota.rateLimitTpm || ""} placeholder="使用系统默认" onChange={e => setQuota({ ...quota, rateLimitTpm: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div><div className="field"><label>最大并发</label><input className="mono" value={quota.maxConcurrency || ""} placeholder="使用系统默认" onChange={e => setQuota({ ...quota, maxConcurrency: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div></div>
              <div className="hint">留空或 0 表示使用系统设置里的默认用户限制。</div>
              <div className="hint mono">已用：${quota.usedUsd.toFixed(4)}</div>
            </div>
            <div className="modal-foot"><button className="btn ghost" onClick={() => setQuotaTarget(null)}>取消</button><button className="btn primary" onClick={saveQuota}>保存</button></div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>删除用户</h2>
              <button className="modal-close" onClick={() => setDeleteTarget(null)} aria-label="关闭">×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">确认删除用户 <span className="mono">{deleteTarget.username}</span>？</p>
              <p className="confirm-sub">删除后该用户将无法登录，所有相关数据保留。</p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="btn danger" onClick={() => remove(deleteTarget)}>删除</button>
            </div>
          </div>
        </div>
      )}

      <div className="table-wrap">
      <table className="table users-table">
        <thead><tr>{sortHeader("username", "用户名")}{sortHeader("displayName", "显示名称")}{sortHeader("email", "邮箱")}{sortHeader("balance", "余额")}{sortHeader("role", "角色")}{sortHeader("status", "状态")}{sortHeader("createdAt", "创建时间")}<th className="right">操作</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="empty"><span className="loading-spinner" aria-label="加载中" /></td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={8} className="empty">暂无匹配用户 <span className="mono dim">// no rows</span></td></tr>}
          {sortedRows.map(row => (
            <tr className="clickable-row" key={row.id} onClick={() => router.push(`/users/${row.id}`)}>
              <td className="mono"><Link href={`/users/${row.id}`}>{row.username}</Link></td>
              <td>{row.displayName}</td>
              <td className="mono dim">{row.email || "—"}</td>
              <td className="mono nowrap users-balance-cell">{fmtUsd(userBalance(row))} <span className="dim">剩余</span></td>
              <td className="users-control-cell" onClick={e => e.stopPropagation()}><Select size="sm" value={row.role} onChange={v => patch(row, { role: v as Role })} options={roleOptions} /></td>
              <td className="users-control-cell users-status-cell" onClick={e => e.stopPropagation()}><button className={`toggle-label ${row.status === "active" ? "on" : "off"}`} onClick={() => patch(row, { status: row.status === "active" ? "disabled" : "active" })}><span className="dot" />{row.status === "pending" ? "待验证" : row.status === "active" ? "启用" : "停用"}</button></td>
              <td className="mono dim">{formatShanghaiDate(row.createdAt)}</td>
              <td className="right nowrap users-actions-cell" onClick={e => e.stopPropagation()}>
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
                  aria-label={`${row.username} 操作`}
                  aria-expanded={openActionsId === row.id}
                >
                  <MoreHorizontal />
                </button>
                {openActionsId === row.id && openActionsRect && (
                  <div className="row-actions-popover" style={openActionsRect}>
                    <button onClick={() => { setOpenActionsId(null); openQuota(row); }}>额度</button>
                    <button className="danger" onClick={() => { setOpenActionsId(null); setDeleteTarget(row); }}>删除</button>
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

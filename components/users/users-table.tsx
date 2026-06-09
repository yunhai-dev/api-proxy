"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { useSortableRows } from "@/components/ui/sortable-table";
import { useToast } from "@/components/toast";

type Role = "super_admin" | "admin" | "user";
type User = { id: string; username: string; displayName: string; email: string; role: Role; status: "pending" | "active" | "disabled"; createdAt: number; updatedAt: number; quotaUsd: number; usedUsd: number };
type UserQuota = { quotaUsd: number; usedUsd: number; rateLimitRpm: number; rateLimitTpm: number; maxConcurrency: number };

const roleOptions = [
  { value: "super_admin", label: "超级管理员" },
  { value: "admin", label: "管理员" },
  { value: "user", label: "用户" },
];

const pageSize = 20;

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
  const [role, setRole] = useState<Role>("user");
  const [quotaTarget, setQuotaTarget] = useState<User | null>(null);
  const [quota, setQuota] = useState<UserQuota | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const { sortedRows, sortHeader, sort } = useSortableRows(rows, {
    username: row => row.username,
    displayName: row => row.displayName,
    email: row => row.email,
    balance: row => userBalance(row),
    role: row => row.role,
    status: row => row.status,
    createdAt: row => row.createdAt,
  }, "username");

  useEffect(() => { load(); }, [page, query, roleFilter, statusFilter, sort.key, sort.dir]);
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
    const r = await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, displayName, email, role }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || "创建失败"); return; }
    toast("用户已创建");
    setUsername(""); setDisplayName(""); setEmail(""); setRole("user"); setOpen(false); load();
  }

  async function patch(row: User, body: Partial<User>) {
    const r = await fetch(`/api/users/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { toast("用户已更新"); load(); }
  }

  async function remove(row: User) {
    const r = await fetch(`/api/users/${row.id}`, { method: "DELETE" });
    if (r.ok) { toast("用户已删除"); load(); }
  }

  async function openQuota(row: User) {
    setQuotaTarget(row);
    const r = await fetch(`/api/users/${row.id}/quota`);
    if (r.ok) setQuota(await r.json());
  }

  async function saveQuota() {
    if (!quotaTarget || !quota) return;
    const r = await fetch(`/api/users/${quotaTarget.id}/quota`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(quota) });
    if (r.ok) { toast("额度已更新"); setQuotaTarget(null); setQuota(null); load(); }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  return (
    <>
      <div className="page-actions"><button className="btn primary" onClick={() => setOpen(true)}>+ 新建用户</button></div>
      <div className="list-toolbar">
        <Input tone="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索用户名 / 显示名 / 邮箱" />
        <Select value={roleFilter} onChange={setRoleFilter} options={[{ value: "all", label: "全部角色" }, ...roleOptions]} />
        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "pending", label: "待验证" }, { value: "active", label: "启用" }, { value: "disabled", label: "停用" }]} />
        <span className="spacer" />
        <span className="mono dim">{loading ? <span className="loading-spinner" aria-label="加载中" /> : `${total} users`}</span>
      </div>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>新建用户</h2><button className="modal-close" onClick={() => setOpen(false)}>×</button></div>
            <div className="modal-body">
              <div className="field"><label>用户名</label><input className="mono" value={username} onChange={e => setUsername(e.target.value)} /></div>
              <div className="field"><label>显示名称</label><input value={displayName} onChange={e => setDisplayName(e.target.value)} /></div>
              <div className="field"><label>邮箱</label><input className="mono" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></div>
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
              <div className="field"><label>额度 ($)</label><input className="mono" value={quota.quotaUsd || ""} onChange={e => setQuota({ ...quota, quotaUsd: Number(e.target.value) || 0 })} /></div>
              <div className="field-row"><div className="field"><label>RPM</label><input className="mono" value={quota.rateLimitRpm || ""} placeholder="使用系统默认" onChange={e => setQuota({ ...quota, rateLimitRpm: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div><div className="field"><label>TPM</label><input className="mono" value={quota.rateLimitTpm || ""} placeholder="使用系统默认" onChange={e => setQuota({ ...quota, rateLimitTpm: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div><div className="field"><label>最大并发</label><input className="mono" value={quota.maxConcurrency || ""} placeholder="使用系统默认" onChange={e => setQuota({ ...quota, maxConcurrency: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div></div>
              <div className="hint">留空或 0 表示使用系统设置里的默认用户限制。</div>
              <div className="hint mono">已用：${quota.usedUsd.toFixed(4)}</div>
            </div>
            <div className="modal-foot"><button className="btn ghost" onClick={() => setQuotaTarget(null)}>取消</button><button className="btn primary" onClick={saveQuota}>保存</button></div>
          </div>
        </div>
      )}

      <div className="table-wrap">
      <table className="table users-table">
        <thead><tr>{sortHeader("username", "用户名")}{sortHeader("displayName", "显示名称")}{sortHeader("email", "邮箱")}{sortHeader("balance", "余额")}{sortHeader("role", "角色")}{sortHeader("status", "状态")}{sortHeader("createdAt", "创建时间")}<th className="right">操作</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="empty"><span className="loading-spinner" aria-label="加载中" /></td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={8} className="empty">暂无匹配用户</td></tr>}
          {sortedRows.map(row => (
            <tr className="clickable-row" key={row.id} onClick={() => router.push(`/users/${row.id}`)}>
              <td className="mono"><Link href={`/users/${row.id}`}>{row.username}</Link></td>
              <td>{row.displayName}</td>
              <td className="mono dim">{row.email || "—"}</td>
              <td className="mono nowrap users-balance-cell">{fmtUsd(userBalance(row))} <span className="dim">剩余</span></td>
              <td className="users-control-cell" onClick={e => e.stopPropagation()}><Select size="sm" value={row.role} onChange={v => patch(row, { role: v as Role })} options={roleOptions} /></td>
              <td className="users-control-cell users-status-cell" onClick={e => e.stopPropagation()}><button className={`toggle-label ${row.status === "active" ? "on" : "off"}`} onClick={() => patch(row, { status: row.status === "active" ? "disabled" : "active" })}><span className="dot" />{row.status === "pending" ? "待验证" : row.status === "active" ? "启用" : "停用"}</button></td>
              <td className="mono dim">{new Date(row.createdAt).toISOString().slice(0, 10)}</td>
              <td className="right users-actions-cell" onClick={e => e.stopPropagation()}><span className="users-actions"><button className="btn sm ghost" onClick={() => openQuota(row)}>额度</button><button className="btn sm ghost danger" onClick={() => remove(row)}>删除</button></span></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <ListPagination page={safePage} pageSize={pageSize} total={total} onPageChange={setPage} />
    </>
  );
}

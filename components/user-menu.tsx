"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef } from "react";

export function UserMenu({ collapsed = false, label }: { collapsed?: boolean; label: string }) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const initials = (label || "--").slice(0, 2).toUpperCase();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    if (detailsRef.current) detailsRef.current.open = false;
    router.push("/login");
    router.refresh();
  }

  return (
    <details className="relative" ref={detailsRef}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted hover:text-foreground" title={collapsed ? label : undefined}>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border bg-muted text-xs text-foreground">{initials}</span>
        {!collapsed && <span className="max-w-28 truncate">{label}</span>}
      </summary>
      <div className="absolute bottom-full right-0 z-50 mb-2 grid min-w-36 gap-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md lg:left-0 lg:right-auto">
        <Link className="rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground" href="/account" onClick={() => { if (detailsRef.current) detailsRef.current.open = false; }}>个人信息</Link>
        <button className="rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground" type="button" onClick={logout}>退出登录</button>
      </div>
    </details>
  );
}

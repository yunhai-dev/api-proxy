"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard", key: "D", label: "我的总览" },
  { href: "/keys",      key: "K", label: "密钥" },
  { href: "/logs",      key: "L", label: "日志" },
  { href: "/console/docs", key: "?", label: "文档" },
];

const ADMIN_TABS = [
  { href: "/dashboard",       key: "I", label: "我的总览" },
  { href: "/admin/dashboard", key: "D", label: "管理总览" },
  { href: "/users",           key: "U", label: "用户" },
  { href: "/channels",        key: "C", label: "渠道" },
  { href: "/models",          key: "O", label: "模型" },
  { href: "/admin/keys",      key: "K", label: "密钥" },
  { href: "/admin/logs",      key: "L", label: "日志" },
  { href: "/console/docs",    key: "?", label: "文档" },
];

const MORE_TABS = [
  { href: "/admin/channel-status", key: "H", label: "状态" },
  { href: "/mappings",        key: "M", label: "映射" },
  { href: "/pricing",         key: "P", label: "定价" },
  { href: "/gift-cards",      key: "G", label: "礼品卡" },
  { href: "/rankings",        key: "R", label: "排行榜" },
  { href: "/audit",           key: "A", label: "审计日志" },
  { href: "/settings",        key: "S", label: "设置" },
];

const itemClass = "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";
const activeClass = "bg-muted text-foreground";
const keyClass = "rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground";

export function NavTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const moreRef = useRef<HTMLDetailsElement>(null);
  const moreTabs = isAdmin ? MORE_TABS : [];
  const tabs = isAdmin ? ADMIN_TABS : TABS;
  const moreActive = moreTabs.some(t => pathname === t.href);

  useEffect(() => {
    if (moreRef.current) moreRef.current.open = false;
  }, [pathname]);

  return (
    <nav className="flex min-w-max items-center gap-1" aria-label="主导航">
      {tabs.map(t => {
        const active = pathname === t.href || (t.href === "/dashboard" && pathname === "/");
        return (
          <Link key={t.href} href={t.href} className={cn(itemClass, active && activeClass)}>
            <span className={keyClass}>{t.key}</span> {t.label}
          </Link>
        );
      })}
      {moreTabs.length > 0 && <details ref={moreRef} className="relative shrink-0">
        <summary className={cn(itemClass, "cursor-pointer list-none", moreActive && activeClass)}>
          <span className={keyClass}>··</span> 更多
        </summary>
        <div className="absolute left-0 top-full z-50 mt-2 grid min-w-40 gap-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {moreTabs.map(t => {
            const active = pathname === t.href;
            return (
              <Link key={t.href} href={t.href} className={cn(itemClass, "w-full justify-start", active && activeClass)} onClick={() => { if (moreRef.current) moreRef.current.open = false; }}>
                <span className={keyClass}>{t.key}</span> {t.label}
              </Link>
            );
          })}
        </div>
      </details>}
    </nav>
  );
}

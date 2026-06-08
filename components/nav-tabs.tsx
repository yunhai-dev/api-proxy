"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

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
    <nav className="nav">
      {tabs.map(t => {
        const active = pathname === t.href || (t.href === "/dashboard" && pathname === "/");
        return (
          <Link key={t.href} href={t.href} className={active ? "active" : ""}>
            <span className="key">{t.key}</span> {t.label}
          </Link>
        );
      })}
      {moreTabs.length > 0 && <details ref={moreRef} className={`nav-more${moreActive ? " active" : ""}`}>
        <summary>
          <span className="key">··</span> 更多
        </summary>
        <div className="nav-more-menu">
          {moreTabs.map(t => {
            const active = pathname === t.href;
            return (
              <Link key={t.href} href={t.href} className={active ? "active" : ""} onClick={() => { if (moreRef.current) moreRef.current.open = false; }}>
                <span className="key">{t.key}</span> {t.label}
              </Link>
            );
          })}
        </div>
      </details>}
    </nav>
  );
}

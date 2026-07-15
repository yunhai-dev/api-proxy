"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  Box,
  ClipboardList,
  DollarSign,
  FileText,
  Gift,
  KeyRound,
  LayoutDashboard,
  Route,
  Server,
  Settings,
  SquareActivity,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

const TABS: NavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "我的总览" },
  { href: "/keys", icon: KeyRound, label: "密钥" },
  { href: "/logs", icon: FileText, label: "日志" },
  { href: "/console/docs", icon: BookOpen, label: "文档" },
];

const ADMIN_TABS: NavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "我的总览" },
  { href: "/admin/dashboard", icon: LayoutDashboard, label: "管理总览" },
  { href: "/users", icon: Users, label: "用户" },
  { href: "/channels", icon: Server, label: "渠道" },
  { href: "/models", icon: Box, label: "模型" },
  { href: "/admin/keys", icon: KeyRound, label: "密钥" },
  { href: "/admin/logs", icon: FileText, label: "日志" },
  { href: "/console/docs", icon: BookOpen, label: "文档" },
];

const MORE_TABS: NavItem[] = [
  { href: "/admin/channel-status", icon: Activity, label: "状态" },
  { href: "/mappings", icon: Route, label: "映射" },
  { href: "/pricing", icon: DollarSign, label: "定价" },
  { href: "/gift-cards", icon: Gift, label: "礼品卡" },
  { href: "/rankings", icon: Trophy, label: "排行榜" },
  { href: "/audit", icon: ClipboardList, label: "审计日志" },
  { href: "/admin/sub2api", icon: SquareActivity, label: "Sub2API 状态" },
  { href: "/settings", icon: Settings, label: "设置" },
];

const itemClass = "flex h-9 w-full shrink-0 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:justify-start lg:group-data-[collapsed=true]/sidebar:justify-center lg:group-data-[collapsed=true]/sidebar:px-0";
const activeClass = "bg-muted text-foreground";

export function NavTabs({ collapsed = false, isAdmin = false }: { collapsed?: boolean; isAdmin?: boolean }) {
  const pathname = usePathname();
  const tabs = isAdmin ? ADMIN_TABS : TABS;
  const sidebarTabs = isAdmin ? [...tabs, ...MORE_TABS] : tabs;

  return (
    <nav className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col" aria-label="主导航">
      {sidebarTabs.map(t => {
        const Icon = t.icon;
        const active = pathname === t.href || (t.href === "/dashboard" && pathname === "/");
        return (
          <Link key={t.href} href={t.href} className={cn(itemClass, active && activeClass)} title={collapsed ? t.label : undefined}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="transition-[opacity,width] duration-200 ease-in-out lg:group-data-[collapsed=true]/sidebar:sr-only">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

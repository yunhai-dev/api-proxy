"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { NavTabs } from "./nav-tabs";
import { Clock } from "./clock";
import { UserMenu } from "./user-menu";
import { AnnouncementSurface } from "./announcement";
import { cn } from "@/lib/utils";
import type { Announcement } from "@/lib/announcement";
import Link from "next/link";

const COLLAPSE_KEY = "sidebarCollapsed";

export function SidebarShell({
  isAdmin,
  userLabel,
  siteName,
  siteLogoUrl,
  announcement,
  initiallyCollapsed = false,
}: {
  isAdmin: boolean;
  userLabel: string;
  siteName: string;
  siteLogoUrl?: string;
  announcement: Announcement | null;
  initiallyCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    return () => document.body.classList.remove("sidebar-collapsed");
  }, [collapsed]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${COLLAPSE_KEY}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "group/sidebar flex shrink-0 flex-col border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 transition-[width] duration-200 ease-in-out lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r",
        collapsed ? "lg:w-16" : "lg:w-64",
      )}
    >
      <div className="flex min-h-14 items-center gap-2 border-b px-4 transition-[padding] duration-200 ease-in-out lg:px-5 lg:group-data-[collapsed=true]/sidebar:justify-center lg:group-data-[collapsed=true]/sidebar:px-3">
        <Link
          href="/"
          className="inline-flex min-w-0 flex-1 items-center gap-2 font-mono text-sm font-medium text-foreground lg:group-data-[collapsed=true]/sidebar:sr-only"
          aria-label={`${siteName} 首页`}
        >
          {siteLogoUrl ? (
            <img src={siteLogoUrl} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />
          ) : (
            <span className="inline-block h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-primary/80 to-primary shadow-sm" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{siteName}</span>
        </Link>
        <button
          aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:inline-flex"
          type="button"
          onClick={toggle}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto px-3 py-3 lg:overflow-y-auto">
        <NavTabs collapsed={collapsed} isAdmin={isAdmin} />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground lg:flex-col lg:items-stretch lg:px-5 lg:group-data-[collapsed=true]/sidebar:items-center lg:group-data-[collapsed=true]/sidebar:px-3">
        <Clock collapsed={collapsed} />
        <UserMenu collapsed={collapsed} label={userLabel} />
      </div>
      <AnnouncementSurface announcement={announcement} scope="app" />
    </aside>
  );
}

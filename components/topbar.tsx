import { NavTabs } from "./nav-tabs";
import { Clock } from "./clock";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { UserMenu } from "./user-menu";
import { getSettingsAsync } from "@/lib/settings";
import { announcementFromSettings } from "@/lib/announcement";
import { AnnouncementSurface } from "./announcement";
import Link from "next/link";
import { SiteLogo } from "./site-logo";

export async function Topbar() {
  const user = await getCurrentUser();
  const settings = await getSettingsAsync();
  const announcement = announcementFromSettings(settings);
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="flex min-h-14 flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:px-8">
          <Link href="/" className="inline-flex min-w-0 items-center gap-2 font-mono text-sm font-medium" aria-label={`${settings.siteName} 首页`}>
            <SiteLogo logoUrl={settings.siteLogoUrl} alt={settings.siteName} />
            <span className="truncate">{settings.siteName}</span>
          </Link>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <NavTabs isAdmin={user ? isAdmin(user) : false} />
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
            <Clock />
            <UserMenu label={user?.displayName || user?.username || "未登录"} />
          </div>
        </div>
      </header>
      <AnnouncementSurface announcement={announcement} scope="app" />
    </>
  );
}

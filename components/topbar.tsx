import { cookies } from "next/headers";
import { SidebarShell } from "./sidebar-shell";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getSettingsAsync } from "@/lib/settings";
import { announcementFromSettings } from "@/lib/announcement";

export async function Topbar() {
  const user = await getCurrentUser();
  const settings = await getSettingsAsync();
  const announcement = announcementFromSettings(settings);
  const collapseCookie = (await cookies()).get("sidebarCollapsed")?.value;
  const initiallyCollapsed = collapseCookie === "1";
  return (
    <SidebarShell
      isAdmin={user ? isAdmin(user) : false}
      userLabel={user?.displayName || user?.username || "未登录"}
      siteName={settings.siteName}
      siteLogoUrl={settings.siteLogoUrl}
      announcement={announcement}
      initiallyCollapsed={initiallyCollapsed}
    />
  );
}

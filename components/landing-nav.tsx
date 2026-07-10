import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { AnnouncementSurface } from "@/components/announcement";
import { announcementFromSettings } from "@/lib/announcement";
import { getSettingsAsync } from "@/lib/settings";

export async function LandingNav() {
  const [user, settings] = await Promise.all([getCurrentUser(), getSettingsAsync()]);
  const primaryHref = user ? "/dashboard" : "/register";
  const primaryLabel = user ? "进入控制台" : "申请接入";
  const announcement = announcementFromSettings(settings);

  return (
    <>
      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label={settings.siteName}>
          {settings.siteLogoUrl ? (
            <img src={settings.siteLogoUrl} alt="" className="h-6 w-6 shrink-0 rounded object-contain" />
          ) : (
            <span className="inline-block h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-primary/80 to-primary shadow-sm" aria-hidden="true" />
          )}
          <span>{settings.siteName}</span>
        </Link>
        <nav className="landing-links" aria-label="首页导航">
          <Link href="/#features">能力</Link>
          <Link href="/#models">模型</Link>
          <Link href="/#integration">接入</Link>
          <Link href="/docs">文档</Link>
        </nav>
        <div className="landing-actions">
          {!user && <Link className="btn ghost" href="/login">登录</Link>}
          <Link className="btn primary" href={primaryHref}>{primaryLabel}</Link>
        </div>
      </header>
      <AnnouncementSurface announcement={announcement} scope="landing" />
    </>
  );
}

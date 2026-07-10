import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { getSettingsAsync } from "@/lib/settings";
import { AppShell } from "@/components/app-shell";
import { Topbar } from "@/components/topbar";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettingsAsync().catch(() => ({ siteName: "api-proxy", siteLogoUrl: "" }));
  return {
    title: settings.siteName,
    description: "Claude / OpenAI API 中转站",
    icons: settings.siteLogoUrl ? { icon: settings.siteLogoUrl, shortcut: settings.siteLogoUrl, apple: settings.siteLogoUrl } : undefined,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ToastProvider>
          <AppShell topbar={<Topbar />}>
            {children}
          </AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}

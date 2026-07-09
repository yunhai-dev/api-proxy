"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const AUTH_PATHS = new Set(["/login", "/register", "/verify-email", "/forgot-password", "/reset-password"]);

export function AppShell({ children, topbar }: { children: ReactNode; topbar: ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.has(pathname);
  const isLandingPage = pathname === "/";
  const isPublicDocsPage = pathname === "/docs";
  const isModelSquarePage = pathname === "/model-square";
  const isPublicSurface = isLandingPage || isPublicDocsPage || isModelSquarePage;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {!isAuthPage && !isPublicSurface && topbar}
      <main className={cn(!isAuthPage && !isPublicSurface && "px-4 py-6 sm:px-6 lg:px-8")}>{children}</main>
    </div>
  );
}

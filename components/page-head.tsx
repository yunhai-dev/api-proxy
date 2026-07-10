import type { ReactNode } from "react";

type PageHeadSub = ReactNode | string;

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: PageHeadSub;
  actions?: ReactNode;
}) {
  const subtitle = typeof sub === "string" ? <span>{sub}</span> : sub;

  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

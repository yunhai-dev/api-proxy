"use client";

import { useEffect, useState } from "react";
import { fmtClockWithZone } from "@/lib/utils";

export function Clock({ collapsed = false }: { collapsed?: boolean }) {
  const [t, setT] = useState("--:--:--");
  useEffect(() => {
    const tick = () => setT(fmtClockWithZone());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{collapsed ? t.slice(0, 5) : t}</span>;
}

"use client";

import { useEffect, useState } from "react";
import { fmtClockWithZone } from "@/lib/utils";

export function Clock() {
  const [t, setT] = useState("--:--:--");
  useEffect(() => {
    const tick = () => setT(fmtClockWithZone());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{t}</span>;
}

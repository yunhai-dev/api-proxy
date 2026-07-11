"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ChannelHealthList } from "@/components/channels/channel-health-list";

type TestLog = { id: number; ts: number; ok: boolean; latencyMs: number };
type ChannelHealth = { id: string; name: string; type: "claude" | "openai"; status: "ok" | "warn" | "err"; p50Ms: number; testLogs: TestLog[]; totalTests: number; okTests: number };

const REFRESH_BUTTONS = [
  { value: 0, label: "关闭" },
  { value: 5, label: "5s" },
  { value: 10, label: "10s" },
  { value: 15, label: "15s" },
  { value: 30, label: "30s" },
];

export function ChannelStatusClient({
  initialRows,
  since,
  until,
  windowMs,
  windowLabel,
  loadHealth,
}: {
  initialRows: ChannelHealth[];
  since: number;
  until: number;
  windowMs: number;
  windowLabel: string;
  loadHealth: (range: { since: number; until: number }) => Promise<ChannelHealth[]>;
}) {
  const [rows, setRows] = useState(initialRows);
  const [range, setRange] = useState({ since, until });
  const [intervalSec, setIntervalSec] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(Date.now());
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const now = Date.now();
      const nextRange = { since: now - windowMs, until: now };
      const fresh = await loadHealth(nextRange);
      setRows(fresh);
      setRange(nextRange);
      setUpdatedAt(now);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    if (intervalSec <= 0) return;
    const handle = setInterval(reload, intervalSec * 1000);
    return () => clearInterval(handle);
  }, [intervalSec]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const schedule = () => {
      const delay = 1000 - (Date.now() % 1000);
      timeout = setTimeout(() => {
        const update = () => {
          setTick(value => value + 1);
          schedule();
        };
        if ("requestIdleCallback" in window) idleId = window.requestIdleCallback(update, { timeout: 500 });
        else update();
      }, delay);
    };

    schedule();
    return () => {
      if (timeout) clearTimeout(timeout);
      if (idleId !== null && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
    };
  }, []);

  const ageSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));

  return (
    <>
      <div className="channel-status-toolbar">
        <button className="btn sm ghost icon-btn" onClick={reload} disabled={loading} aria-label="立即刷新" title="立即刷新">
          <RefreshCw className={loading ? "animate-spin" : undefined} />
        </button>
        <div className="refresh-buttons" role="radiogroup" aria-label="自动刷新间隔">
          {REFRESH_BUTTONS.map(option => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={intervalSec === option.value}
              className={`refresh-pill ${intervalSec === option.value ? "active" : ""}`}
              onClick={() => setIntervalSec(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="hint">上次更新 {Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))}s 前</span>
      </div>
      <section className="list-section section-stack">
        <ChannelHealthList rows={rows} since={range.since} until={range.until} windowLabel={windowLabel} />
      </section>
    </>
  );
}

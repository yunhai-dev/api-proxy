"use client";

import { useEffect, useRef, useState } from "react";
import { formatShanghaiDateTime } from "@/lib/time";

type TestLog = { id: number; ts: number; ok: boolean; latencyMs: number };
type ChannelHealth = { id: string; name: string; type: "claude" | "openai"; status: "ok" | "warn" | "err"; p50Ms: number; testLogs: TestLog[]; totalTests: number; okTests: number };

type UptimeState = "ok" | "err" | "none";
type UptimeCell = { state: UptimeState; tooltip: string; span: number };

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CELL_WIDTH = 10;
const CELL_GAP = 2;

function formatDuration(ms: number) {
  if (ms >= DAY) return `${(ms / DAY).toFixed(ms >= 10 * DAY ? 0 : 1)} 天`;
  if (ms >= HOUR) return `${(ms / HOUR).toFixed(ms >= 10 * HOUR ? 0 : 1)} 小时`;
  if (ms >= MINUTE) return `${(ms / MINUTE).toFixed(ms >= 10 * MINUTE ? 0 : 1)} 分钟`;
  return `${Math.max(1, Math.round(ms / SECOND))} 秒`;
}

function avgLatency(logs: TestLog[]) {
  if (logs.length === 0) return 0;
  return Math.round(logs.reduce((sum, log) => sum + log.latencyMs, 0) / logs.length);
}

function logTooltip(logs: TestLog[]) {
  if (logs.length === 1) {
    const log = logs[0];
    return `${formatShanghaiDateTime(log.ts)} · ${log.ok ? "成功" : "失败"} · 首字延迟 ${log.latencyMs}ms`;
  }
  const start = logs[0];
  const end = logs[logs.length - 1];
  const ok = logs.filter(log => log.ok).length;
  return `${formatShanghaiDateTime(start.ts)} → ${formatShanghaiDateTime(end.ts)}\n${logs.length} 次测试 · 成功 ${ok} 次 · 平均首字延迟 ${avgLatency(logs)}ms`;
}

function uptimeCells(logs: TestLog[], since: number, until: number, maxCells: number): UptimeCell[] {
  const windowLogs = logs.filter(log => log.ts >= since && log.ts < until).sort((a, b) => a.ts - b.ts);
  if (windowLogs.length === 0) {
    return [{ state: "none", span: 1, tooltip: `${formatShanghaiDateTime(since)} → ${formatShanghaiDateTime(until)}\n${formatDuration(until - since)} 内无测试` }];
  }
  if (windowLogs.length <= maxCells) {
    return windowLogs.map(log => ({ state: log.ok ? "ok" : "err", span: 1, tooltip: logTooltip([log]) }));
  }
  // 仅渲染最新 maxCells 条；更早的日志已用于计算可用性，不在方块中逐一展示。
  const recent = windowLogs.slice(windowLogs.length - maxCells);
  return recent.map(log => ({ state: log.ok ? "ok" : "err", span: 1, tooltip: logTooltip([log]) }));
}

function uptimeText(row: ChannelHealth): string {
  if (!row.totalTests) return "—";
  const pct = row.okTests / row.totalTests * 100;
  return pct === 100 ? "100" : pct.toFixed(3);
}

function useCellCount() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(60);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const width = Math.max(0, node.clientWidth - 32);
      setCount(Math.max(24, Math.floor((width + CELL_GAP) / (CELL_WIDTH + CELL_GAP))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, count };
}

export function ChannelHealthList({ rows, since, until, windowLabel }: { rows: ChannelHealth[]; since: number; until: number; windowLabel: string }) {
  const { ref, count } = useCellCount();

  return (
    <div ref={ref} className="uptime-list">
      {rows.length === 0 && <div className="empty">暂无匹配渠道</div>}
      {rows.map(row => {
        const cells = uptimeCells(row.testLogs, since, until, count);
        const statusText = row.status === "ok" ? "正常" : row.status === "warn" ? "限流" : "降级";
        return (
          <div className="uptime-row" key={row.id}>
            <div className="uptime-head">
              <div className="uptime-name">
                <span className={`status-badge ${row.status}`}><span className="dot" />{statusText}</span>
                <strong>{row.name}</strong>
              </div>
              <span className="uptime-value mono">{uptimeText(row)}<small>% uptime</small></span>
            </div>
            <div className="uptime-segments" style={{ gridTemplateColumns: cells.map(cell => `${cell.span}fr`).join(" ") }} aria-label={`${row.name} 最近可用性`}>
              {cells.map((cell, index) => (
                <span key={index} className={`uptime-segment ${cell.state}`} title={cell.tooltip} />
              ))}
            </div>
            <div className="uptime-axis">
              <span>{windowLabel}前</span>
              <span>现在</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatShanghaiClock } from "./time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function pad2(n: number) { return String(n).padStart(2, "0"); }

export function fmtClock(d = new Date()) {
  return formatShanghaiClock(d.getTime());
}

export function maskKey(prefix: string) {
  return prefix + "••••" + prefix.slice(-2);
}

export function fullKeyFor(prefix: string) {
  return prefix + "a91f…b2c4";
}

export function fmtRelativeTime(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

export function fmtClockStamp(ts: number) {
  return formatShanghaiClock(ts);
}

export function fmtClockWithZone(d = new Date()) {
  return `${fmtClock(d)} · 北京时间`;
}

export function statusLabel(s: number) {
  if (s === 0) return "断网";
  if (s === 499) return "取消";
  if (s < 300) return String(s);
  if (s < 500) return String(s);
  return String(s);
}

export function statusClass(s: number) {
  if (s === 0) return "status-net";
  if (s < 300) return "status-2xx";
  if (s < 500) return "status-4xx";
  return "status-5xx";
}

export function quotaPct(used: number, quota: number) {
  if (quota <= 0) return 0;
  return Math.min(100, (used / quota) * 100);
}

export function quotaCls(used: number, quota: number) {
  const p = quotaPct(used, quota);
  if (p >= 100) return "err";
  if (p >= 80) return "warn";
  return "";
}

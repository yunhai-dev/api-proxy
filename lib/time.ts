const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function shanghaiDate(ms: number) {
  return new Date(ms + SHANGHAI_OFFSET_MS);
}

export function startOfShanghaiDay(ms = Date.now()) {
  return Math.floor((ms + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS;
}

export function toShanghaiDateTimeLocal(ms: number) {
  const d = shanghaiDate(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function parseShanghaiDateTimeLocal(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, h, min] = match;
  const ts = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min)) - SHANGHAI_OFFSET_MS;
  return Number.isFinite(ts) ? ts : null;
}

export function formatShanghaiClock(ms: number) {
  const d = shanghaiDate(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export function formatShanghaiDateTime(ms: number) {
  const d = shanghaiDate(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export function formatShanghaiDate(ms: number) {
  const d = shanghaiDate(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function formatShanghaiTime(ms: number, showDate = false) {
  const d = shanghaiDate(ms);
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  if (!showDate) return time;
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${time}`;
}

import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "./db";
import { testChannel } from "./channel-health";
import { claimRedisLock } from "@/lib/redis-lock";
import { usePostgres } from "@/lib/db/runtime";

type MonitorState = {
  version: number;
  started: boolean;
  timer: ReturnType<typeof setInterval> | null;
  running: Set<string>;
  lastRun: Map<string, number>;
};

const MONITOR_VERSION = 2;

declare global {
  // eslint-disable-next-line no-var
  var __channelMonitor: MonitorState | undefined;
}

const existing = globalThis.__channelMonitor;
if (existing && existing.version !== MONITOR_VERSION && existing.timer) {
  clearInterval(existing.timer);
}
const state = existing && existing.version === MONITOR_VERSION
  ? existing
  : { version: MONITOR_VERSION, started: false, timer: null, running: new Set<string>(), lastRun: new Map<string, number>() };
globalThis.__channelMonitor = state;

export function ensureChannelMonitor() {
  if (state.started) return;
  state.started = true;
  state.timer = setInterval(() => { void runChannelMonitorTick(); }, 1000);
  state.timer.unref?.();
}

export async function runChannelMonitorTick() {
  try {
    await tick();
  } catch (e) {
    console.error("channel monitor tick failed", e);
  }
}

async function tick() {
  const now = Date.now();
  const channels = usePostgres()
    ? await (async () => {
      const { pgDb, pgSchema } = await import("./db/pg");
      return pgDb.select().from(pgSchema.channels).where(and(eq(pgSchema.channels.enabled, true), gt(pgSchema.channels.monitorIntervalSec, 0)));
    })()
    : db
      .select()
      .from(schema.channels)
      .where(and(eq(schema.channels.enabled, true), gt(schema.channels.monitorIntervalSec, 0)))
      .all();

  for (const channel of channels) {
    const intervalMs = Math.max(1, channel.monitorIntervalSec) * 1000;
    const last = state.lastRun.get(channel.id) ?? 0;
    if (state.running.has(channel.id) || now - last < intervalMs) continue;
    if (!await claimMonitorRun(channel.id, now, intervalMs)) continue;
    state.running.add(channel.id);
    state.lastRun.set(channel.id, now);
    testChannel(channel as typeof schema.channels.$inferSelect)
      .catch(() => {})
      .finally(() => state.running.delete(channel.id));
  }
}

async function claimMonitorRun(channelId: string, now: number, intervalMs: number) {
  const redisClaim = await claimRedisLock(`lock:monitor:${channelId}`, intervalMs);
  if (redisClaim !== null) return redisClaim;
  const key = `monitor:${channelId}`;
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("./db/pg");
    const row = (await pgDb.select().from(pgSchema.settings).where(eq(pgSchema.settings.key, key)).limit(1))[0];
    const last = Number(row?.value) || 0;
    if (now - last < intervalMs) return false;
    if (row) await pgDb.update(pgSchema.settings).set({ value: String(now), updatedAt: now }).where(eq(pgSchema.settings.key, key));
    else await pgDb.insert(pgSchema.settings).values({ key, value: String(now), updatedAt: now });
    return true;
  }
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  const last = Number(row?.value) || 0;
  if (now - last < intervalMs) return false;
  if (row) {
    db.update(schema.settings).set({ value: String(now), updatedAt: now }).where(eq(schema.settings.key, key)).run();
  } else {
    db.insert(schema.settings).values({ key, value: String(now), updatedAt: now }).run();
  }
  return true;
}

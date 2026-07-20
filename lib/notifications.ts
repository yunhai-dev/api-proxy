import { and, asc, eq, lte, or } from "drizzle-orm";
import type { pgDb } from "@/lib/db/pg";
import { pgSchema } from "@/lib/db/pg";
import { getSettingsAsync, type AppSettings } from "@/lib/settings";
import { sendMail } from "@/lib/mailer";

type PgWriter = Pick<typeof pgDb, "insert" | "select" | "update">;
type Payload = { title: string; desp: string; subject?: string; text?: string; html?: string };
type PlatformEvent = "channel-circuit" | "no-live-channel" | "upstream-exhausted";

const SERVERCHAN_UID = /^[1-9]\d{0,19}$/;
const LEASE_MS = 60_000;
const BATCH_SIZE = 20;

const platformSwitches: Record<PlatformEvent, { alert: keyof AppSettings; recovery: keyof AppSettings }> = {
  "channel-circuit": { alert: "notifyAdminChannelCircuit", recovery: "notifyAdminChannelCircuitRecovery" },
  "no-live-channel": { alert: "notifyAdminNoLiveChannel", recovery: "notifyAdminNoLiveChannelRecovery" },
  "upstream-exhausted": { alert: "notifyAdminUpstreamExhausted", recovery: "notifyAdminUpstreamExhaustedRecovery" },
};

export function validServerChanUid(value: string) {
  return SERVERCHAN_UID.test(value);
}

export function platformIncidentCooldownElapsed(lastNotifiedAt: number, cooldownMinutes: number, now: number) {
  return lastNotifiedAt === 0 || cooldownMinutes === 0 || now - lastNotifiedAt >= cooldownMinutes * 60_000;
}

export async function sendServerChan(uid: string, sendKey: string, title: string, desp: string, fetcher: typeof fetch = fetch) {
  if (!validServerChanUid(uid) || !sendKey) throw new Error("ServerChan 配置不完整");
  const response = await fetcher(`https://${uid}.push.ft07.com/send/${encodeURIComponent(sendKey)}.send`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ title, desp }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ServerChan HTTP ${response.status}`);
  const result = await response.json().catch(() => null) as { code?: number } | null;
  if (typeof result?.code === "number" && result.code !== 0) throw new Error("ServerChan 拒绝请求");
}

export async function setPlatformIncident(input: {
  stateKey: string;
  eventType: PlatformEvent;
  active: boolean;
  payload: Payload;
  settings?: AppSettings;
  writer?: PgWriter;
}) {
  const { pgDb } = await import("@/lib/db/pg");
  const settings = input.settings ?? await getSettingsAsync();
  const run = async (writer: PgWriter) => {
    const now = Date.now();
    await writer.insert(pgSchema.notificationStates).values({ stateKey: input.stateKey, active: false, generation: 0, updatedAt: now }).onConflictDoNothing();
    const current = (await writer.select().from(pgSchema.notificationStates).where(eq(pgSchema.notificationStates.stateKey, input.stateKey)).limit(1).for("update"))[0];
    if (!current || current.active === input.active) return false;
    const generation = input.active ? current.generation + 1 : current.generation;
    await writer.update(pgSchema.notificationStates).set({ active: input.active, generation, updatedAt: now }).where(eq(pgSchema.notificationStates.stateKey, input.stateKey));
    const switches = platformSwitches[input.eventType];
    const enabled = settings.notificationsAdminEnabled
      && !!settings.serverChanUid
      && !!settings.serverChanSendKey
      && Boolean(settings[input.active ? switches.alert : switches.recovery]);
    if (!enabled || !platformIncidentCooldownElapsed(current.lastNotifiedAt, settings.platformIncidentCooldownMinutes, now)) return true;
    await enqueue(writer, {
      dedupeKey: `${input.stateKey}:${generation}:${input.active ? "alert" : "recovery"}`,
      channel: "serverchan",
      recipient: "",
      eventType: `${input.eventType}:${input.active ? "alert" : "recovery"}`,
      payload: input.payload,
      now,
    });
    await writer.update(pgSchema.notificationStates).set({ lastNotifiedAt: now }).where(eq(pgSchema.notificationStates.stateKey, input.stateKey));
    return true;
  };
  return input.writer ? run(input.writer) : pgDb.transaction(run);
}

export function crossedUsdThresholds(oldUsed: number, newUsed: number, quota: number) {
  if (quota <= 0) return [];
  const oldRemaining = (quota - oldUsed) / quota;
  const newRemaining = (quota - newUsed) / quota;
  return ([20, 10, 0] as const).filter(threshold => oldRemaining > threshold / 100 && newRemaining <= threshold / 100);
}

export function crossedKeyThresholds(oldUsed: number, newUsed: number, quota: number) {
  if (quota <= 0) return [];
  return ([80, 100] as const).filter(threshold => oldUsed / quota < threshold / 100 && newUsed / quota >= threshold / 100);
}

export async function enqueueUserThresholds(input: {
  kind: "user-usd" | "key-quota";
  ownerId: string;
  ownerName: string;
  email: string;
  oldUsed: number;
  newUsed: number;
  quota: number;
  settings: AppSettings;
  writer: PgWriter;
}) {
  const thresholds = input.kind === "user-usd"
    ? crossedUsdThresholds(input.oldUsed, input.newUsed, input.quota)
    : crossedKeyThresholds(input.oldUsed, input.newUsed, input.quota);
  if (!input.settings.notificationsUserEmailEnabled || !input.settings.smtpEnabled || !input.email.trim()) return;
  const now = Date.now();
  for (const threshold of thresholds) {
    const enabled = input.kind === "user-usd"
      ? input.settings[`notifyUserUsdBalance${threshold}` as "notifyUserUsdBalance20"]
      : input.settings[`notifyUserKeyQuota${threshold}` as "notifyUserKeyQuota80"];
    if (!enabled) continue;
    const stateKey = `${input.kind}:${input.ownerId}:${threshold}`;
    await input.writer.insert(pgSchema.notificationStates).values({ stateKey, active: false, generation: 0, updatedAt: now }).onConflictDoNothing();
    const state = (await input.writer.select().from(pgSchema.notificationStates).where(eq(pgSchema.notificationStates.stateKey, stateKey)).limit(1).for("update"))[0];
    if (!state || state.active) continue;
    const generation = state.generation + 1;
    await input.writer.update(pgSchema.notificationStates).set({ active: true, generation, updatedAt: now }).where(eq(pgSchema.notificationStates.stateKey, stateKey));
    const label = input.kind === "user-usd" ? `美元额度剩余 ${threshold}%` : `API Key 配额已用 ${threshold}%`;
    const text = `${input.ownerName}：${label}。当前已用 ${input.newUsed.toFixed(4)} / ${input.quota.toFixed(4)}。`;
    await enqueue(input.writer, {
      dedupeKey: `${stateKey}:${generation}:alert`, channel: "email", recipient: input.email.trim(), eventType: `${input.kind}:${threshold}`,
      payload: { title: label, desp: text, subject: `[${input.settings.siteName}] ${label}`, text }, now,
    });
  }
}

export async function rearmUserThresholds(input: {
  kind: "user-usd" | "key-quota";
  ownerId: string;
  used: number;
  quota: number;
  writer: PgWriter;
}) {
  if (input.quota <= 0) return;
  const thresholds = input.kind === "user-usd" ? [20, 10, 0] : [80, 100];
  for (const threshold of thresholds) {
    const above = input.kind === "user-usd" ? (input.quota - input.used) / input.quota > threshold / 100 : input.used / input.quota < threshold / 100;
    if (above) await input.writer.update(pgSchema.notificationStates).set({ active: false, updatedAt: Date.now() }).where(eq(pgSchema.notificationStates.stateKey, `${input.kind}:${input.ownerId}:${threshold}`));
  }
}

async function enqueue(writer: PgWriter, input: { dedupeKey: string; channel: string; recipient: string; eventType: string; payload: Payload; now: number }) {
  await writer.insert(pgSchema.notificationOutbox).values({
    dedupeKey: input.dedupeKey,
    channel: input.channel,
    recipient: input.recipient,
    eventType: input.eventType,
    payload: JSON.stringify(input.payload),
    status: "pending",
    attempts: 0,
    nextAttemptAt: input.now,
    leaseUntil: 0,
    createdAt: input.now,
    updatedAt: input.now,
  }).onConflictDoNothing();
}

let draining: Promise<number> | null = null;

export function kickNotificationDrain() {
  if (!draining) draining = drainNotificationOutbox().catch(() => 0).finally(() => { draining = null; });
}

export async function drainNotificationOutbox() {
  const { pgDb } = await import("@/lib/db/pg");
  const now = Date.now();
  const claimed = await pgDb.transaction(async tx => {
    const rows = await tx.select().from(pgSchema.notificationOutbox)
      .where(or(
        and(eq(pgSchema.notificationOutbox.status, "pending"), lte(pgSchema.notificationOutbox.nextAttemptAt, now)),
        and(eq(pgSchema.notificationOutbox.status, "sending"), lte(pgSchema.notificationOutbox.leaseUntil, now)),
      ))
      .orderBy(asc(pgSchema.notificationOutbox.nextAttemptAt))
      .limit(BATCH_SIZE)
      .for("update", { skipLocked: true });
    for (const row of rows) {
      await tx.update(pgSchema.notificationOutbox).set({ status: "sending", attempts: row.attempts + 1, leaseUntil: now + LEASE_MS, updatedAt: now }).where(eq(pgSchema.notificationOutbox.id, row.id));
    }
    return rows.map(row => ({ ...row, attempts: row.attempts + 1 }));
  });
  const settings = await getSettingsAsync();
  for (const row of claimed) {
    try {
      const payload = JSON.parse(row.payload) as Payload;
      if (row.channel === "serverchan") await sendServerChan(settings.serverChanUid, settings.serverChanSendKey, payload.title, payload.desp);
      else await sendMail(settings, { to: row.recipient, subject: payload.subject ?? payload.title, text: payload.text ?? payload.desp, html: payload.html });
      await pgDb.update(pgSchema.notificationOutbox).set({ status: "sent", sentAt: Date.now(), leaseUntil: 0, lastError: null, updatedAt: Date.now() }).where(eq(pgSchema.notificationOutbox.id, row.id));
    } catch (error) {
      const delay = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, row.attempts - 1));
      const message = error instanceof Error ? error.message.slice(0, 240) : "通知发送失败";
      await pgDb.update(pgSchema.notificationOutbox).set({ status: "pending", nextAttemptAt: Date.now() + delay, leaseUntil: 0, lastError: message, updatedAt: Date.now() }).where(eq(pgSchema.notificationOutbox.id, row.id));
    }
  }
  return claimed.length;
}

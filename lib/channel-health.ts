import { db, schema } from "./db";
import { eq } from "drizzle-orm";
import { endpointFor, headersFor, resolveOpenAiEndpoint, type OpenAiEndpoint } from "./upstream";
import { usePostgres } from "./db/runtime";
import { kickNotificationDrain, setPlatformIncident } from "./notifications";

const TIMEOUT_MS = 15_000;
const CIRCUIT_COOLDOWN_MS = 10_000;
const CIRCUIT_OPEN_ERR_RATE = 50;

type CircuitState = "closed" | "open" | "half_open";

type CircuitChannel = {
  circuitState?: string;
  circuitOpenedAt?: number;
};

type HealthChannel = typeof schema.channels.$inferSelect & CircuitChannel;

export function circuitAllows(channel: CircuitChannel) {
  return channel.circuitState !== "open";
}

async function markCircuitHalfOpen(channel: HealthChannel) {
  if (channel.circuitState !== "open" || Date.now() - (channel.circuitOpenedAt ?? 0) < CIRCUIT_COOLDOWN_MS) return;
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("./db/pg");
    await pgDb.update(pgSchema.channels)
      .set({ circuitState: "half_open" })
      .where(eq(pgSchema.channels.id, channel.id));
    return;
  }
  db.update(schema.channels)
    .set({ circuitState: "half_open" })
    .where(eq(schema.channels.id, channel.id))
    .run();
}

export function nextCircuitState(input: {
  state?: CircuitState;
  openedAt?: number;
  ok: boolean;
  errRate?: number;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  if (input.ok) return { state: "closed" as const, openedAt: 0 };
  if (input.state === "open" && now - (input.openedAt ?? 0) < CIRCUIT_COOLDOWN_MS) {
    return { state: "open" as const, openedAt: input.openedAt ?? now };
  }
  if (input.state === "half_open" || (input.errRate ?? 100) >= CIRCUIT_OPEN_ERR_RATE) {
    return { state: "open" as const, openedAt: now };
  }
  return { state: "closed" as const, openedAt: 0 };
}

function testModelFor(channel: typeof schema.channels.$inferSelect) {
  return channel.testModel || channel.models.find(model => model && model !== "*") || "";
}

function testBody(channel: typeof schema.channels.$inferSelect, model: string, endpoint?: OpenAiEndpoint) {
  if (channel.type === "openai" && endpoint === "responses") {
    return JSON.stringify({
      model,
      max_output_tokens: 1,
      input: "ping",
    });
  }
  return JSON.stringify({
    model,
    max_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
  });
}

export async function pingChannel(channel: typeof schema.channels.$inferSelect): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  const model = testModelFor(channel);
  if (!model) return { ok: false, latencyMs: 0, error: "未配置测试模型" };
  const openAiEndpoint = resolveOpenAiEndpoint(channel.type, channel.openAiProtocol);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpointFor(channel.type, channel.baseUrl, openAiEndpoint), {
      method: "POST",
      headers: headersFor(channel.type, channel.apiKey),
      body: testBody(channel, model, openAiEndpoint),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, latencyMs: Date.now() - t0, error: text.slice(0, 120) || `HTTP ${res.status}` };
    }
    if (isErrorBody(text)) {
      return { ok: false, latencyMs: Date.now() - t0, error: text.slice(0, 120) || "上游返回错误响应" };
    }
    return {
      ok: true,
      latencyMs: Date.now() - t0,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, latencyMs: Date.now() - t0, error: msg.includes("abort") ? "timeout" : msg.slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

function isErrorBody(text: string) {
  if (!text.trim()) return false;
  try {
    const data = JSON.parse(text) as { error?: unknown; type?: unknown };
    return !!data.error || data.type === "error";
  } catch {
    return false;
  }
}

export async function testChannel(channel: HealthChannel) {
  await markCircuitHalfOpen(channel);
  const ping = await pingChannel(channel);
  return recordChannelObservation({ ...channel, circuitState: channel.circuitState === "open" ? "half_open" : channel.circuitState }, ping, { failureStatus: "err" });
}

export async function recordChannelObservation(
  channel: HealthChannel,
  ping: { ok: boolean; latencyMs: number; error?: string },
  opts: { failureStatus?: "warn" | "err" } = {},
) {
  const p50 = Math.round(0.9 * channel.p50Ms + 0.1 * ping.latencyMs);
  const err = Math.round((0.9 * channel.errRate + 0.1 * (ping.ok ? 0 : 100)) * 10) / 10;
  const circuit = opts.failureStatus === "err"
    ? nextCircuitState({ state: channel.circuitState as CircuitState | undefined, openedAt: channel.circuitOpenedAt, ok: ping.ok, errRate: err })
    : { state: (channel.circuitState as CircuitState | undefined) ?? "closed", openedAt: channel.circuitOpenedAt ?? 0 };
  const status: "ok" | "warn" | "err" = circuit.state === "open"
    ? "err"
    : ping.ok ? (err > 5 ? "warn" : "ok") : "warn";
  const ts = Date.now();

  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("./db/pg");
    await pgDb.update(pgSchema.channels)
      .set({ p50Ms: p50, errRate: err, status, circuitState: circuit.state, circuitOpenedAt: circuit.openedAt })
      .where(eq(pgSchema.channels.id, channel.id));
    await pgDb.insert(pgSchema.channelTestLogs).values({ channelId: channel.id, ts, ok: ping.ok, latencyMs: ping.latencyMs, errorMsg: ping.error ?? null });
    if (channel.circuitState !== circuit.state && (circuit.state === "open" || circuit.state === "closed")) {
      void setPlatformIncident({
        stateKey: `channel-circuit:${channel.id}`,
        eventType: "channel-circuit",
        active: circuit.state === "open",
        payload: {
          title: circuit.state === "open" ? `渠道熔断：${channel.name}` : `渠道恢复：${channel.name}`,
          desp: circuit.state === "open" ? `渠道 ${channel.name} 已进入熔断状态。${ping.error ? `错误：${ping.error.slice(0, 120)}` : ""}` : `渠道 ${channel.name} 已恢复并关闭熔断。`,
        },
      }).then(changed => { if (changed) kickNotificationDrain(); }).catch(() => null);
    }
    return { ping, p50, err, status, circuit };
  }

  db.update(schema.channels)
    .set({ p50Ms: p50, errRate: err, status, circuitState: circuit.state, circuitOpenedAt: circuit.openedAt })
    .where(eq(schema.channels.id, channel.id))
    .run();
  db.insert(schema.channelTestLogs).values({
    channelId: channel.id,
    ts,
    ok: ping.ok,
    latencyMs: ping.latencyMs,
    errorMsg: ping.error ?? null,
  }).run();

  return { ping, p50, err, status, circuit };
}

// @ts-expect-error Bun provides this module at test runtime.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Channel = Record<string, unknown>;

const key = {
  id: "key-1", userId: "", status: "active", quota: 0, used: 0,
  rateLimitRpm: 0, rateLimitTpm: 100, maxConcurrency: 0, channelId: "",
  name: "test key", prefix: "sk-relay-test", fullKey: "sk-relay-test-secret",
};

const primary: Channel = {
  id: "primary", name: "primary", type: "openai", enabled: true, status: "ok",
  models: ["gpt-test"], weight: 10, maxConcurrency: 0, baseUrl: "https://primary.test",
  apiKey: "primary-key", capabilities: [], circuitState: "closed", circuitOpenedAt: 0,
};
const fallback: Channel = {
  ...primary, id: "fallback", name: "fallback", baseUrl: "https://fallback.test", apiKey: "fallback-key",
};

let channels: Channel[] = [];
let settings: Record<string, unknown> = {};
let upstreamCalls: string[] = [];
let reserveCalls = 0;
let settlements: (number | null)[] = [];

const schema = Object.fromEntries([
  "keys", "channels", "modelMappings", "userQuotas", "requestLogs",
].map(name => [name, { name, id: name, prefix: name, fullKey: name, userId: name, type: name, enabled: name, ts: name, keyId: name, tokensIn: name, tokensOut: name }]));

mock.module("./db", () => ({
  schema,
  db: {
    select: () => ({
      from: (table: { name: string }) => ({
        where: () => ({
          get: () => table.name === "keys" ? key : table.name === "channels" ? channels.find(row => row.id === "fallback") : undefined,
          all: () => table.name === "channels" ? channels : [],
        }),
        all: () => table.name === "channels" ? channels : [],
      }),
    }),
  },
}));
mock.module("./db/runtime", () => ({ usePostgres: () => false }));
mock.module("./settings", () => ({ getSettingsAsync: async () => settings }));
mock.module("./model-catalog", () => ({ modelConfigAsync: async () => null }));
mock.module("./channel-health", () => ({
  circuitAllows: () => true,
  recordChannelObservation: async (channel: Channel) => ({ status: channel.status }),
}));
mock.module("./channel-queue", () => ({
  acquireChannelSlot: async () => () => {},
  isChannelSaturated: async () => false,
}));
mock.module("./key-queue", () => ({ acquireKeySlot: async () => () => {} }));
mock.module("./rate-limit", () => ({
  checkTpm: async () => true,
  consumeRpm: async () => true,
  reserveTpm: async () => {
    reserveCalls += 1;
    return { requestId: "request-1", keyId: "key-1", userId: "" };
  },
  settleTpmReservation: async (_reservation: unknown, actual: number | null) => { settlements.push(actual); },
}));
mock.module("./log-generator", () => ({
  logHub: { recordAsync: async () => ({ id: 1 }), updateAsync: async () => {} },
}));
mock.module("./user-quota", () => ({
  effectiveUserLimits: () => ({ rateLimitTpm: 0, rateLimitRpm: 0, maxConcurrency: 0 }),
  effectiveUserLimitsAsync: async () => ({ rateLimitTpm: 0, rateLimitRpm: 0, maxConcurrency: 0 }),
}));
mock.module("./upstream", () => ({
  callUpstream: async (input: { baseUrl: string }) => {
    upstreamCalls.push(input.baseUrl);
    return upstreamResponses.shift();
  },
}));

const { proxyOnce } = await import("./proxy");
let upstreamResponses: { ok: boolean; status: number; errorMsg?: string; headers?: Headers; body?: ReadableStream<Uint8Array>; contentType?: string }[] = [];

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    contentType: "application/json",
    body: new Response(JSON.stringify(body)).body!,
  };
}

beforeEach(() => {
  channels = [primary];
  settings = {
    maintenanceMode: false, fallbackEnabled: false, fallbackChannelId: "", fallbackModel: "",
    proxyMaxRetries: 2, proxyRetryNetwork: true, proxyRetry429: false, proxyRetry5xx: true,
    proxyTreatEmptyOutputAsFailure: false, recordAllRequestDetails: false, bridgeCapabilityAudit: false,
  };
  upstreamCalls = [];
  reserveCalls = 0;
  settlements = [];
  upstreamResponses = [];
});

function request() {
  return {
    type: "openai" as const,
    openAiEndpoint: "chat_completions" as const,
    rawAuth: "Bearer sk-relay-test-secret",
    stream: false,
    incomingHeaders: new Headers({ "x-request-id": "request-1" }),
    body: JSON.stringify({ model: "gpt-test", messages: [{ role: "user", content: "hi" }], max_completion_tokens: 40 }),
  };
}

describe("proxy TPM reservation lifecycle", () => {
  test("shares one reservation across a retry and settles actual usage", async () => {
    upstreamResponses = [
      { ok: false, status: 503, errorMsg: "unavailable" },
      response({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 5 } }),
    ];

    const result = await proxyOnce(request());

    expect(result.kind).toBe("success");
    expect(upstreamCalls).toEqual(["https://primary.test", "https://primary.test"]);
    expect(reserveCalls).toBe(1);
    expect(settlements).toEqual([8]);
  });

  test("shares one reservation with a successful fallback", async () => {
    channels = [primary, fallback];
    settings = { ...settings, fallbackEnabled: true, fallbackChannelId: "fallback", fallbackModel: "gpt-test", proxyMaxRetries: 1 };
    upstreamResponses = [
      { ok: false, status: 503, errorMsg: "unavailable" },
      response({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 7 } }),
    ];

    const result = await proxyOnce(request());

    expect(result.kind).toBe("success");
    expect(upstreamCalls).toEqual(["https://primary.test", "https://fallback.test"]);
    expect(reserveCalls).toBe(1);
    expect(settlements).toEqual([9]);
  });
});

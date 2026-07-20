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
let mappings: Record<string, unknown>[] = [];
let settings: Record<string, unknown> = {};
let upstreamCalls: string[] = [];
let upstreamBodies: string[] = [];
let reserveCalls = 0;
let settlements: (number | null)[] = [];
let channelReleases = 0;
let keyReleases = 0;
let circuitAllowed = true;
let channelObservations: { ok: boolean; failureStatus?: string }[] = [];
let logRecords: Record<string, unknown>[] = [];
let failLogUpdate = false;

const schema = Object.fromEntries([
  "keys", "channels", "modelMappings", "userQuotas", "requestLogs",
].map(name => [name, { name, id: name, prefix: name, fullKey: name, userId: name, type: name, enabled: name, ts: name, keyId: name, tokensIn: name, tokensOut: name }]));

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

mock.module("./db", () => ({
  schema,
  db: {
    select: () => ({
      from: (table: { name: string }) => ({
        where: () => ({
          get: () => table.name === "keys" ? key : table.name === "channels" ? fallback : undefined,
          all: () => table.name === "channels" ? channels : table.name === "modelMappings" ? mappings : [],
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
  circuitAllows: () => circuitAllowed,
  recordChannelObservation: async (channel: Channel, ping: { ok: boolean }, options?: { failureStatus?: string }) => {
    channelObservations.push({ ok: ping.ok, failureStatus: options?.failureStatus });
    return { status: channel.status };
  },
}));
mock.module("./channel-queue", () => ({
  acquireChannelSlot: async () => () => { channelReleases += 1; },
  isChannelSaturated: async () => false,
}));
mock.module("./key-queue", () => ({ acquireKeySlot: async () => () => { keyReleases += 1; } }));
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
  logHub: {
    recordAsync: async (entry: Record<string, unknown>) => { logRecords.push(entry); return { id: 1 }; },
    updateAsync: async (_id: number, entry: Record<string, unknown>) => { if (failLogUpdate) throw new Error("log update failed"); logRecords.push(entry); },
  },
}));
mock.module("./user-quota", () => ({
  effectiveUserLimits: () => ({ rateLimitTpm: 0, rateLimitRpm: 0, maxConcurrency: 0 }),
  effectiveUserLimitsAsync: async () => ({ rateLimitTpm: 0, rateLimitRpm: 0, maxConcurrency: 0 }),
}));
mock.module("./upstream", () => ({
  callUpstream: async (input: { baseUrl: string; body: string }) => {
    upstreamCalls.push(input.baseUrl);
    upstreamBodies.push(input.body);
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
  mappings = [];
  settings = {
    maintenanceMode: false, fallbackEnabled: false, fallbackChannelId: "", fallbackModel: "",
    proxyMaxRetries: 2, proxyRetryNetwork: true, proxyRetry429: false, proxyRetry5xx: true,
    proxyTreatEmptyOutputAsFailure: false, recordAllRequestDetails: false, bridgeCapabilityAudit: false,
  };
  upstreamCalls = [];
  upstreamBodies = [];
  reserveCalls = 0;
  settlements = [];
  channelReleases = 0;
  keyReleases = 0;
  circuitAllowed = true;
  channelObservations = [];
  logRecords = [];
  failLogUpdate = false;
  upstreamResponses = [];
  key.status = "active";
  key.quota = 0;
  key.used = 0;
  key.channelId = "";
});

function request(stream = false) {
  return {
    type: "openai" as const,
    openAiEndpoint: "chat_completions" as const,
    rawAuth: "Bearer sk-relay-test-secret",
    stream,
    incomingHeaders: new Headers({ "x-request-id": "request-1" }),
    body: JSON.stringify({ model: "gpt-test", messages: [{ role: "user", content: "hi" }], max_completion_tokens: 40 }),
  };
}

function responsesRequest(stream = false) {
  return {
    ...request(stream),
    openAiEndpoint: "responses" as const,
    body: JSON.stringify({ model: "gpt-test", input: "hi", max_output_tokens: 16 }),
  };
}

function claudeRequest(stream = false) {
  return {
    type: "claude" as const,
    rawAuth: "Bearer sk-relay-test-secret",
    stream,
    incomingHeaders: new Headers({ "x-request-id": "request-1" }),
    body: JSON.stringify({ model: "claude-test", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
  };
}

function streamResponse(text: string) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    contentType: "text/event-stream",
    body: new Response(text).body!,
  };
}

describe("proxy TPM reservation lifecycle", () => {
  test("converts a Claude upstream response for an OpenAI bridge request", async () => {
    mappings = [{ id: "mapping-1", provider: "openai", targetProvider: "claude", inboundModel: "gpt-test", upstreamModel: "claude-test", enabled: true, channelIds: [] }];
    channels = [{ ...primary, type: "claude", models: ["claude-test"], capabilities: ["messages", "chat_completions"] }];
    upstreamResponses = [response({ id: "msg_1", type: "message", role: "assistant", model: "claude-test", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 2, output_tokens: 3 } })];

    const result = await proxyOnce(request());

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("expected bridge success");
    expect(await result.response.json()).toMatchObject({ object: "chat.completion", choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3 } });
  });

  test("converts an OpenAI upstream response for a Claude bridge request", async () => {
    mappings = [{ id: "mapping-1", provider: "claude", targetProvider: "openai", inboundModel: "claude-test", upstreamModel: "gpt-test", enabled: true, channelIds: [] }];
    channels = [{ ...primary, models: ["gpt-test"], capabilities: ["chat_completions", "messages"] }];
    upstreamResponses = [response({ id: "chatcmpl_1", object: "chat.completion", model: "gpt-test", choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3 } })];

    const result = await proxyOnce(claudeRequest());

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("expected bridge success");
    expect(await result.response.json()).toMatchObject({ type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 2, output_tokens: 3 } });
  });

  test("converts a Claude stream for an OpenAI Responses bridge request", async () => {
    mappings = [{ id: "mapping-1", provider: "openai", targetProvider: "claude", inboundModel: "gpt-test", upstreamModel: "claude-test", enabled: true, channelIds: [] }];
    channels = [{ ...primary, type: "claude", models: ["claude-test"], capabilities: ["messages", "responses", "streaming"] }];
    upstreamResponses = [streamResponse(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n'
      + 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n'
      + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":2,"output_tokens":3}}\n\n'
      + 'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    )];

    const result = await proxyOnce(responsesRequest(true));

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("expected stream success");
    const text = await result.response.text();
    expect(text).toContain("event: response.created");
    expect(text).toContain("event: response.output_text.delta");
    expect(text).toContain('"delta":"ok"');
    expect(text).toContain("event: response.completed");
  });

  test("does not stop an OpenAI Responses native stream after the first delta", async () => {
    upstreamResponses = [streamResponse(
      'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}\n\n'
      + 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n'
      + 'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":2,"output_tokens":3}}}\n\n',
    )];

    const result = await proxyOnce(responsesRequest(true));

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("expected stream success");
    const text = await result.response.text();
    expect(text).toContain("event: response.output_text.delta");
    expect(text).toContain("event: response.completed");
  });

  test("converts a Claude stream for an OpenAI bridge request", async () => {
    mappings = [{ id: "mapping-1", provider: "openai", targetProvider: "claude", inboundModel: "gpt-test", upstreamModel: "claude-test", enabled: true, channelIds: [] }];
    channels = [{ ...primary, type: "claude", models: ["claude-test"], capabilities: ["messages", "chat_completions", "streaming"] }];
    upstreamResponses = [streamResponse(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n'
      + 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n'
      + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":2,"output_tokens":3}}\n\n'
      + 'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    )];

    const result = await proxyOnce(request(true));

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("expected stream success");
    const text = await result.response.text();
    expect(text).toContain('"content":"ok"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain("data: [DONE]");
  });

  test("converts an OpenAI stream for a Claude bridge request", async () => {
    mappings = [{ id: "mapping-1", provider: "claude", targetProvider: "openai", inboundModel: "claude-test", upstreamModel: "gpt-test", enabled: true, channelIds: [] }];
    channels = [{ ...primary, models: ["gpt-test"], capabilities: ["chat_completions", "messages", "streaming"] }];
    upstreamResponses = [streamResponse(
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n'
      + "data: [DONE]\n\n",
    )];

    const result = await proxyOnce(claudeRequest(true));

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("expected stream success");
    const text = await result.response.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain('"text":"ok"');
    expect(text).toContain('"stop_reason":"end_turn"');
  });

  test("preserves native OpenAI request controls upstream", async () => {
    upstreamResponses = [response({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })];
    const body = { model: "gpt-test", messages: [{ role: "user", content: "hi" }], temperature: 0.25, response_format: { type: "json_object" }, metadata: { trace: "native" } };

    const result = await proxyOnce({ ...request(), body: JSON.stringify(body) });

    expect(result.kind).toBe("success");
    expect(JSON.parse(upstreamBodies[0]!)).toMatchObject(body);
  });

  test("preserves native Claude request controls upstream", async () => {
    channels = [{ ...primary, type: "claude", models: ["claude-test"] }];
    upstreamResponses = [response({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } })];
    const body = { model: "claude-test", max_tokens: 16, system: "be brief", messages: [{ role: "user", content: "hi" }], temperature: 0.25, stop_sequences: ["END"], metadata: { user_id: "native" } };

    const result = await proxyOnce({ ...claudeRequest(), body: JSON.stringify(body) });

    expect(result.kind).toBe("success");
    expect(JSON.parse(upstreamBodies[0]!)).toMatchObject(body);
  });

  test("converts a Claude response for an OpenAI Responses bridge request", async () => {
    mappings = [{ id: "mapping-1", provider: "openai", targetProvider: "claude", inboundModel: "gpt-test", upstreamModel: "claude-test", enabled: true, channelIds: [] }];
    channels = [{ ...primary, type: "claude", models: ["claude-test"], capabilities: ["messages", "responses"] }];
    upstreamResponses = [response({ id: "msg_1", type: "message", role: "assistant", model: "claude-test", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 2, output_tokens: 3 } })];

    const result = await proxyOnce(responsesRequest());

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("expected bridge success");
    expect(await result.response.json()).toMatchObject({ object: "response", status: "completed", model: "gpt-test", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 2, output_tokens: 3 } });
  });

  test("preserves native Responses request controls upstream", async () => {
    upstreamResponses = [response({ id: "resp_1", object: "response", status: "completed", output: [] })];
    const body = { model: "gpt-test", input: [{ role: "user", content: "hi" }], max_output_tokens: 16, metadata: { trace: "native" }, reasoning: { effort: "high" } };

    const result = await proxyOnce({ ...responsesRequest(), body: JSON.stringify(body) });

    expect(result.kind).toBe("success");
    expect(JSON.parse(upstreamBodies[0]!)).toMatchObject(body);
  });

  test("preserves parallel_tool_calls for native OpenAI text endpoints", async () => {
    channels = [{ ...primary, models: ["codex-mini", "gpt-test"] }];
    upstreamResponses = [
      response({ id: "resp_1", object: "response", status: "completed", output: [] }),
      response({ id: "resp_2", object: "response", status: "completed", output: [] }),
    ];

    const codexResult = await proxyOnce({
      ...responsesRequest(),
      incomingHeaders: new Headers({ "x-request-id": "request-1" }),
      body: JSON.stringify({ model: "codex-mini", input: "hi", parallel_tool_calls: true }),
    });
    const gptResult = await proxyOnce({
      ...responsesRequest(),
      incomingHeaders: new Headers({ "x-request-id": "request-2" }),
      body: JSON.stringify({ model: "gpt-test", input: "hi", parallel_tool_calls: true }),
    });

    expect(codexResult.kind).toBe("success");
    expect(gptResult.kind).toBe("success");
    expect(JSON.parse(upstreamBodies[0]!).parallel_tool_calls).toBe(true);
    expect(JSON.parse(upstreamBodies[1]!).parallel_tool_calls).toBe(true);
  });

  test("records reasoning effort in request detail without full body logging", async () => {
    upstreamResponses = [response({ id: "resp_1", object: "response", status: "completed", output: [], usage: { input_tokens: 2, output_tokens: 3 } })];
    const body = { model: "gpt-test", input: "hi", max_output_tokens: 16, reasoning: { effort: "high" } };

    const result = await proxyOnce({ ...responsesRequest(), body: JSON.stringify(body) });

    expect(result.kind).toBe("success");
    const detail = JSON.parse(String(logRecords.at(-1)?.requestDetail ?? "{}"));
    expect(detail.reasoning).toEqual({ effort: "high" });
    expect(detail.request_body).toBeNull();
  });

  test("logs disabled key failures with key identity", async () => {
    key.status = "disabled";

    const result = await proxyOnce(request());

    expect(result).toMatchObject({ kind: "client_error", status: 403 });
    expect(logRecords.at(-1)).toMatchObject({ keyId: "key-1", keyName: "test key", keyPrefix: "sk-relay-test" });
  });

  test("returns 429 during maintenance mode", async () => {
    settings = { ...settings, maintenanceMode: true, maintenanceMessage: "维护中" };

    const result = await proxyOnce(request());

    expect(result).toMatchObject({ kind: "client_error", status: 429, error: "维护中" });
    expect(logRecords.at(-1)).toMatchObject({ status: 429 });
  });

  test("rejects unsupported bridge fields before upstream dispatch", async () => {
    mappings = [{ id: "mapping-1", provider: "openai", targetProvider: "claude", inboundModel: "gpt-test", upstreamModel: "claude-test", enabled: true, channelIds: [] }];
    channels = [{ ...primary, type: "claude", models: ["claude-test"], capabilities: ["messages", "chat_completions", "structured_output"] }];

    const result = await proxyOnce({
      ...request(),
      body: JSON.stringify({ model: "gpt-test", messages: [{ role: "user", content: "hi" }], response_format: { type: "json_object" } }),
    });

    expect(result).toMatchObject({ kind: "client_error", status: 400 });
    expect(upstreamCalls).toEqual([]);
  });

  test("does not dispatch an incompatible bridge request to fallback", async () => {
    mappings = [{ id: "mapping-1", provider: "openai", targetProvider: "claude", inboundModel: "gpt-test", upstreamModel: "claude-test", enabled: true, channelIds: [] }];
    channels = [{ ...primary, type: "claude", models: ["claude-test"], capabilities: ["messages", "chat_completions", "structured_output"] }, { ...fallback, type: "claude", models: ["claude-test"], capabilities: ["messages", "chat_completions", "structured_output"] }];
    settings = { ...settings, fallbackEnabled: true, fallbackChannelId: "fallback", fallbackModel: "claude-test" };

    const result = await proxyOnce({
      ...request(),
      body: JSON.stringify({ model: "gpt-test", messages: [{ role: "user", content: "hi" }], response_format: { type: "json_object" } }),
    });

    expect(result).toMatchObject({ kind: "client_error", status: 400 });
    expect(upstreamCalls).toEqual([]);
  });

  test("uses fallback even when the key is bound to another channel", async () => {
    channels = [{ ...primary, models: ["other-model"] }, { ...fallback }];
    key.channelId = "primary";
    settings = { ...settings, fallbackEnabled: true, fallbackChannelId: "fallback", fallbackModel: "gpt-test" };
    upstreamResponses = [response({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 7 } })];

    const result = await proxyOnce(request());

    expect(result.kind).toBe("success");
    expect(upstreamCalls).toEqual(["https://fallback.test"]);
  });

  test("uses fallback across providers without explicit capabilities", async () => {
    channels = [{ ...primary, type: "claude", models: ["claude-test"], capabilities: [] }, { ...fallback, type: "openai", models: ["gpt-test"], capabilities: [] }];
    settings = { ...settings, fallbackEnabled: true, fallbackChannelId: "fallback", fallbackModel: "gpt-test", proxyMaxRetries: 1 };
    upstreamResponses = [
      { ok: false, status: 503, errorMsg: "unavailable" },
      response({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 7 } }),
    ];

    const result = await proxyOnce(claudeRequest());

    expect(result.kind).toBe("success");
    expect(upstreamCalls).toEqual(["https://primary.test", "https://fallback.test"]);
  });

  test("uses fallback even when the fallback channel is circuit-open", async () => {
    channels = [{ ...primary, models: ["other-model"] }, { ...fallback, status: "err", circuitState: "open", circuitOpenedAt: Date.now() }];
    circuitAllowed = false;
    settings = { ...settings, fallbackEnabled: true, fallbackChannelId: "fallback", fallbackModel: "gpt-test" };
    upstreamResponses = [response({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 7 } })];

    const result = await proxyOnce(request());

    expect(result.kind).toBe("success");
    expect(upstreamCalls).toEqual(["https://fallback.test"]);
  });

  test("records an upstream failure and releases its slots", async () => {
    upstreamResponses = [{ ok: false, status: 503, errorMsg: "unavailable" }];
    settings = { ...settings, proxyMaxRetries: 1 };

    const result = await proxyOnce(request());

    expect(result).toMatchObject({ kind: "upstream_error", status: 503 });
    expect(channelObservations).toEqual([{ ok: false, failureStatus: "err" }]);
    expect(channelReleases).toBe(1);
    expect(keyReleases).toBe(2);
  });

  test("shares one reservation across a retry and switches channels", async () => {
    channels = [{ ...primary }, { ...fallback, weight: 1 }];
    settings = { ...settings, proxyMaxRetries: 1 };
    upstreamResponses = [
      { ok: false, status: 503, errorMsg: "unavailable" },
      response({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 5 } }),
    ];

    const result = await proxyOnce(request());

    expect(result.kind).toBe("success");
    expect(upstreamCalls).toEqual(["https://primary.test", "https://fallback.test"]);
    expect(reserveCalls).toBe(1);
    expect(settlements).toEqual([8]);
  });

  test("shares one reservation with a successful fallback", async () => {
    channels = [{ ...primary }, { ...fallback, weight: 1 }];
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

  test("falls back after an upstream model 404", async () => {
    channels = [{ ...primary }, { ...fallback, weight: 1 }];
    settings = { ...settings, fallbackEnabled: true, fallbackChannelId: "fallback", fallbackModel: "gpt-test", proxyMaxRetries: 1 };
    upstreamResponses = [
      { ok: false, status: 404, errorMsg: "model not found" },
      response({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 7 } }),
    ];

    const result = await proxyOnce(request());

    expect(result.kind).toBe("success");
    expect(upstreamCalls).toEqual(["https://primary.test", "https://fallback.test"]);
  });

  test("settles stream usage and releases slots after completion", async () => {
    upstreamResponses = [streamResponse(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
      + 'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":5}}\n\n'
      + "data: [DONE]\n\n",
    )];

    const result = await proxyOnce(request(true));

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("expected stream success");
    await result.response.text();
    await flush();
    expect(reserveCalls).toBe(1);
    expect(settlements).toEqual([8]);
    expect(channelReleases).toBe(1);
    expect(keyReleases).toBe(2);
  });

  test("retains stream TPM reservation and releases slots on cancellation", async () => {
    upstreamResponses = [streamResponse(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    )];

    const result = await proxyOnce(request(true));

    expect(result.kind).toBe("success");
    if (result.kind !== "success" || !result.response.body) throw new Error("expected stream body");
    const reader = result.response.body.getReader();
    await reader.read();
    await reader.cancel();
    await flush();
    expect(settlements).toEqual([null]);
    expect(channelReleases).toBe(1);
    expect(keyReleases).toBe(2);
  });

  test("releases stream slots when the request aborts after headers", async () => {
    const controller = new AbortController();
    const upstream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
      },
    });
    upstreamResponses = [{ ok: true, status: 200, headers: new Headers({ "content-type": "text/event-stream" }), contentType: "text/event-stream", body: upstream }];

    const result = await proxyOnce({ ...request(true), signal: controller.signal });
    expect(result.kind).toBe("success");
    controller.abort();
    await flush();

    expect(settlements).toEqual([null]);
    expect(channelReleases).toBe(1);
    expect(keyReleases).toBe(2);
  });

  test("releases stream slots when final logging fails", async () => {
    failLogUpdate = true;
    upstreamResponses = [streamResponse(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' + "data: [DONE]\n\n",
    )];

    const result = await proxyOnce(request(true));
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error("expected stream success");
    await result.response.text().catch(() => null);
    await flush();

    expect(channelReleases).toBe(1);
    expect(keyReleases).toBe(2);
  });
});

// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import type { Channel } from "./db/pg-schema";
import { circuitAllows, nextCircuitState, pingChannel } from "./channel-health";

describe("channel circuit state", () => {
  test("keeps a closed circuit on a single classified failure", () => {
    const closed = nextCircuitState({ state: "closed", openedAt: 0, ok: false, errRate: 10, now: 1_000 });
    expect(closed).toEqual({ state: "closed", openedAt: 0 });
    expect(circuitAllows({ circuitState: closed.state, circuitOpenedAt: closed.openedAt })).toBe(true);
  });

  test("opens after repeated classified failures and blocks until cooldown", () => {
    const opened = nextCircuitState({ state: "closed", openedAt: 0, ok: false, errRate: 50, now: 1_000 });
    expect(opened).toEqual({ state: "open", openedAt: 1_000 });
    expect(circuitAllows({ circuitState: opened.state, circuitOpenedAt: opened.openedAt })).toBe(false);
  });

  test("closes a successful probe even during cooldown", () => {
    expect(nextCircuitState({ state: "open", openedAt: 1_000, ok: true, now: 2_000 }))
      .toEqual({ state: "closed", openedAt: 0 });
  });

  test("reopens a failed half-open probe", () => {
    expect(nextCircuitState({ state: "half_open", openedAt: 1_000, ok: false, now: 31_001 }))
      .toEqual({ state: "open", openedAt: 31_001 });
  });

});

const baseChannel: Channel = {
  id: "channel-1",
  name: "test",
  type: "openai",
  openAiProtocol: "auto",
  baseUrl: "https://api.example.com",
  apiKey: "secret",
  weight: 1,
  maxConcurrency: 0,
  monitorIntervalSec: 0,
  testModel: "test-model",
  models: [],
  status: "ok",
  circuitState: "closed",
  circuitOpenedAt: 0,
  p50Ms: 0,
  errRate: 0,
  enabled: true,
  capabilities: [],
};

async function captureRequest(channel: Channel) {
  const originalFetch = globalThis.fetch;
  let request: { url: string; body: unknown } | undefined;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response("{}", { status: 200 });
  };
  try {
    expect((await pingChannel(channel)).ok).toBe(true);
    return request;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("channel health protocol", () => {
  const cases: [string, Channel, string, object][] = [
    ["Claude Messages", { ...baseChannel, type: "claude" }, "https://api.example.com/v1/messages", { model: "test-model", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }],
    ["OpenAI auto", baseChannel, "https://api.example.com/v1/chat/completions", { model: "test-model", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }],
    ["OpenAI chat", { ...baseChannel, openAiProtocol: "chat_completions" }, "https://api.example.com/v1/chat/completions", { model: "test-model", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }],
    ["OpenAI Responses", { ...baseChannel, openAiProtocol: "responses" }, "https://api.example.com/v1/responses", { model: "test-model", max_output_tokens: 1, input: "ping" }],
  ];

  test.each(cases)("uses %s URL and body", async (_name: string, channel: Channel, url: string, body: object) => {
    expect(await captureRequest(channel)).toEqual({ url, body });
  });

  test("does not fetch without a test model", async () => {
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      return new Response("{}");
    };
    try {
      expect(await pingChannel({ ...baseChannel, testModel: "", models: ["*"] })).toEqual({
        ok: false,
        latencyMs: 0,
        error: "未配置测试模型",
      });
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

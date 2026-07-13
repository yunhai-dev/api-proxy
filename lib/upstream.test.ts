// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { callUpstream, endpointFor, headersFor, validateUpstreamBaseUrl } from "./upstream";

describe("upstream headers", () => {
  test("replaces credentials and forwards only allowlisted OpenAI headers", () => {
    const headers = headersFor("openai", "upstream-secret", new Headers({
      authorization: "Bearer client-secret",
      cookie: "session=secret",
      "idempotency-key": "request-1",
      "openai-project": "project-1",
      "x-arbitrary": "blocked",
    }));
    expect(headers.get("authorization")).toBe("Bearer upstream-secret");
    expect(headers.get("idempotency-key")).toBe("request-1");
    expect(headers.get("openai-project")).toBe("project-1");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-arbitrary")).toBeNull();
  });

  test("keeps Claude credentials server-side while allowing version controls", () => {
    const headers = headersFor("claude", "upstream-secret", new Headers({
      "x-api-key": "client-secret",
      "anthropic-version": "2026-01-01",
      "anthropic-beta": "feature-2026-01-01",
    }));
    expect(headers.get("x-api-key")).toBe("upstream-secret");
    expect(headers.get("anthropic-version")).toBe("2026-01-01");
    expect(headers.get("anthropic-beta")).toBe("feature-2026-01-01");
  });
});

describe("upstream transport", () => {
  test("uses endpoint-native paths and preserves Retry-After", async () => {
    expect(endpointFor("openai", "https://api.example.com", "responses")).toBe("https://api.example.com/v1/responses");
    expect(endpointFor("claude", "https://api.example.com/v1")).toBe("https://api.example.com/v1/messages");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("busy", { status: 429, headers: { "retry-after": "3" } });
    try {
      const result = await callUpstream({
        channelType: "openai",
        baseUrl: "https://api.example.com",
        upstreamKey: "upstream-secret",
        model: "gpt-5",
        body: "{}",
        stream: false,
      });
      expect(result).toEqual({ ok: false, status: 429, errorMsg: "busy (retry-after: 3)" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("upstream URL validation", () => {
  test("accepts HTTP(S) URLs and rejects unsafe URLs", () => {
    expect(validateUpstreamBaseUrl("https://api.example.com/v1")).toBeNull();
    expect(validateUpstreamBaseUrl("http://api.example.com")).toBeNull();
    expect(validateUpstreamBaseUrl("ftp://api.example.com")).not.toBeNull();
    expect(validateUpstreamBaseUrl("https://user:pass@example.com")).not.toBeNull();
    expect(validateUpstreamBaseUrl("not a URL")).not.toBeNull();
  });
});

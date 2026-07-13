// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { protocolDirection, proxyErrorSource, selectedCapabilityProfile, upstreamRequestId } from "./proxy";

describe("protocol observability", () => {
  test("labels native and bridged routes", () => {
    expect(protocolDirection("openai", "openai")).toBe("native");
    expect(protocolDirection("claude", "openai")).toBe("claude_to_openai");
    expect(protocolDirection("openai", "claude")).toBe("openai_to_claude");
  });

  test("captures only allowlisted upstream request ids", () => {
    expect(upstreamRequestId(new Headers({ "x-request-id": "openai-123" }))).toBe("openai-123");
    expect(upstreamRequestId(new Headers({ "request-id": "request-456" }))).toBe("request-456");
    expect(upstreamRequestId(new Headers({ "authorization": "secret" }))).toBeNull();
  });

  test("combines selected channel and model capabilities without duplicates", () => {
    expect(selectedCapabilityProfile(["messages", "streaming"], ["streaming", "tools"])).toEqual([
      "messages", "streaming", "tools",
    ]);
  });

  test("labels proxy-generated and upstream-generated errors", () => {
    expect(proxyErrorSource({ kind: "client_error", requestId: "r1", status: 404, error: "x" })).toBe("proxy");
    expect(proxyErrorSource({ kind: "upstream_error", requestId: "r2", status: 503, error: "x", attempts: [] })).toBe("proxy");
    expect(proxyErrorSource({ kind: "upstream_error", requestId: "r3", status: 503, error: "x", attempts: [{ channel: "c", error: "e", status: 503 }] })).toBe("upstream");
  });
});

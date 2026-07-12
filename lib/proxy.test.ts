// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { protocolDirection } from "./proxy";

describe("protocol observability", () => {
  test("labels native and bridged routes", () => {
    expect(protocolDirection("openai", "openai")).toBe("native");
    expect(protocolDirection("claude", "openai")).toBe("claude_to_openai");
    expect(protocolDirection("openai", "claude")).toBe("openai_to_claude");
  });
});

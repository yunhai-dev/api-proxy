// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import {
  requiredCapabilities,
  routeSupportsCapabilities,
  validateCapabilities,
} from "./protocol-capabilities";

describe("protocol capabilities", () => {
  test("requires the selected upstream endpoint", () => {
    expect(requiredCapabilities({
      sourceType: "openai",
      targetType: "claude",
      openAiEndpoint: "chat_completions",
      body: {},
      stream: false,
    })).toEqual(["messages"]);

    expect(requiredCapabilities({
      sourceType: "claude",
      targetType: "openai",
      body: {},
      stream: false,
    })).toEqual(["chat_completions"]);
  });

  test("requires bridge features and excludes incompatible routes", () => {
    const required = requiredCapabilities({
      sourceType: "openai",
      targetType: "claude",
      openAiEndpoint: "responses",
      body: {
        input: [{ type: "function_call", call_id: "call_1" }],
        tools: [],
        reasoning: { effort: "high" },
      },
      stream: true,
    });
    expect(required).toEqual([
      "messages",
      "streaming",
      "tools",
      "tool_replay",
      "reasoning",
    ]);
    expect(routeSupportsCapabilities({
      channelCapabilities: ["messages", "streaming", "tools"],
      modelCapabilities: ["tool_replay", "reasoning"],
      sourceType: "openai",
      targetType: "claude",
      required,
    })).toBe(true);
    expect(routeSupportsCapabilities({
      channelCapabilities: ["messages", "streaming", "tools"],
      modelCapabilities: ["reasoning"],
      sourceType: "openai",
      targetType: "claude",
      required,
    })).toBe(false);
  });

  test("keeps native traffic eligible and validates profiles", () => {
    expect(routeSupportsCapabilities({
      channelCapabilities: [],
      modelCapabilities: [],
      sourceType: "openai",
      targetType: "openai",
      required: ["responses", "streaming"],
    })).toBe(true);
    expect(validateCapabilities(["messages", "messages", "tools"])).toEqual({
      ok: true,
      capabilities: ["messages", "tools"],
    });
    expect(validateCapabilities(["unknown"])).toMatchObject({ ok: false });
  });
});

// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { convertRequestBody, createSseResponseConverter } from "./protocol-conversion";

function chat(effort: unknown, model = "claude-opus-4-8") {
  return convertRequestBody({
    sourceType: "openai",
    targetType: "claude",
    body: { model: "gpt-5", messages: [{ role: "user", content: "hi" }], reasoning_effort: effort },
    model,
    stream: false,
  });
}

function responses(effort: unknown, model = "claude-opus-4-8") {
  return convertRequestBody({
    sourceType: "openai",
    targetType: "claude",
    openAiEndpoint: "responses",
    body: { model: "gpt-5", input: "hi", reasoning: { effort } },
    model,
    stream: false,
  });
}

describe("OpenAI reasoning effort conversion", () => {
  test.each([
    ["minimal", "low"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
    ["max", "max"],
  ] as const)("maps %s to %s for Chat and Responses", (effort: string, expected: string) => {
    for (const body of [chat(effort), responses(effort)]) {
      expect(body.thinking).toEqual({ type: "adaptive" });
      expect(body.output_config).toEqual({ effort: expected });
      expect(body).not.toHaveProperty("budget_tokens");
    }
  });

  test("uses compatible fallbacks for unknown Claude models", () => {
    expect(chat("none", "claude-compatible")).not.toHaveProperty("thinking");
    expect(chat("xhigh", "claude-compatible").output_config).toEqual({ effort: "high" });
    expect(responses("max", "claude-compatible").output_config).toEqual({ effort: "high" });
  });

  test("disables thinking only for Claude models that support it", () => {
    expect(chat("none").thinking).toEqual({ type: "disabled" });
    expect(chat("none", "claude-fable-5")).not.toHaveProperty("thinking");
  });

  test("rejects invalid effort values", () => {
    expect(() => chat("extreme")).toThrow("reasoning effort must be");
    expect(() => responses(1)).toThrow("reasoning effort must be");
  });
});

describe("strict OpenAI to Claude conversion", () => {
  function convertChat(body: Record<string, unknown>) {
    return convertRequestBody({
      sourceType: "openai",
      targetType: "claude",
      body: { model: "gpt-5", messages: [{ role: "user", content: "hi" }], ...body },
      model: "claude-opus-4-8",
      stream: false,
    });
  }

  test("preserves developer instructions as Claude system text", () => {
    const converted = convertChat({
      messages: [
        { role: "system", content: "system instruction" },
        { role: "developer", content: "developer instruction" },
        { role: "user", content: "hi" },
      ],
    });
    expect(converted.system).toBe("system instruction\n\ndeveloper instruction");
    expect(converted.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("uses max_completion_tokens when max_tokens is absent", () => {
    expect(convertChat({ max_completion_tokens: 2048 }).max_tokens).toBe(2048);
  });

  test("rejects fields and content that would be silently lost", () => {
    expect(() => convertChat({ response_format: { type: "json_object" } })).toThrow("response_format");
    expect(() => convertChat({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.test/image.png" } }] }] })).toThrow("base64 data URL");
    expect(() => convertChat({ messages: [{ role: "developer", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }] })).toThrow("developer content");
  });

  test("rejects malformed tools and historical tool calls", () => {
    expect(() => convertChat({ tools: [{ type: "function", function: { name: "lookup" } }] })).toThrow("parameters");
    expect(() => convertChat({ messages: [{ role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "not json" } }] }] })).toThrow("arguments");
  });

  test("converts Responses function-call replay", () => {
    const converted = convertRequestBody({
      sourceType: "openai",
      targetType: "claude",
      openAiEndpoint: "responses",
      body: {
        model: "gpt-5",
        input: [
          { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"q":"hello"}' },
          { type: "function_call_output", call_id: "call_1", output: "result" },
        ],
      },
      model: "claude-opus-4-8",
      stream: false,
    });
    expect(converted.messages).toEqual([
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "lookup", input: { q: "hello" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "result" }] },
    ]);
  });
});

describe("Claude to Responses SSE conversion", () => {
  test("emits a complete terminal response with usage", () => {
    const convert = createSseResponseConverter({
      sourceType: "openai", targetType: "claude", openAiEndpoint: "responses", model: "gpt-5",
    });
    const output = convert?.([
      "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\"}}\n\n",
      "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n",
      "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":3,\"output_tokens\":2}}\n\n",
      "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
    ].join(""), true) ?? "";
    expect(output).toContain("event: response.completed");
    expect(output).toContain("\"output_tokens\":2");
    expect(output).toContain("\"text\":\"hello\"");
  });

  test("marks max_tokens termination as incomplete", () => {
    const convert = createSseResponseConverter({
      sourceType: "openai", targetType: "claude", openAiEndpoint: "responses", model: "gpt-5",
    });
    const output = convert?.([
      "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{}}\n\n",
      "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"}}\n\n",
      "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
    ].join(""), true) ?? "";
    expect(output).toContain("event: response.incomplete");
    expect(output).not.toContain("event: response.completed");
    expect(output).toContain("\"reason\":\"max_output_tokens\"");
  });
});

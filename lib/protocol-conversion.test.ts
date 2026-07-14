// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { convertRequestBody, convertResponseBody, createSseResponseConverter } from "./protocol-conversion";

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

describe("Claude to OpenAI conversion", () => {
  test("does not leak Claude thinking blocks into Chat Completions text", () => {
    const converted = convertRequestBody({
      sourceType: "claude",
      targetType: "openai",
      openAiEndpoint: "chat_completions",
      body: {
        model: "claude-opus-4-8",
        messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "internal" }, { type: "text", text: "visible" }] }],
      },
      model: "gpt-5",
      stream: false,
    });

    expect(converted.messages).toEqual([{ role: "assistant", content: [{ type: "text", text: "visible" }] }]);
    expect(JSON.stringify(converted)).not.toContain("internal");
  });

  test("preserves Claude thinking as Responses reasoning", () => {
    const converted = convertRequestBody({
      sourceType: "claude",
      targetType: "openai",
      openAiEndpoint: "responses",
      body: {
        model: "claude-opus-4-8",
        messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "internal" }, { type: "text", text: "visible" }] }],
      },
      model: "gpt-5",
      stream: false,
    });

    expect(converted.input).toEqual([
      { id: expect.any(String), type: "reasoning", summary: [{ type: "summary_text", text: "internal" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "visible" }] },
    ]);
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

  test("converts Responses reasoning output to Claude thinking", () => {
    const converted = JSON.parse(convertResponseBody({
      sourceType: "claude",
      targetType: "openai",
      openAiEndpoint: "responses",
      body: JSON.stringify({
        id: "resp_1",
        status: "completed",
        output: [
          { id: "rs_1", type: "reasoning", summary: [{ type: "summary_text", text: "internal" }] },
          { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "visible" }] },
        ],
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
      model: "claude-opus-4-8",
    }));

    expect(converted.content).toEqual([{ type: "thinking", thinking: "internal" }, { type: "text", text: "visible" }]);
  });


  test("preserves every accepted Chat request control", () => {
    const converted = convertChat({
      max_tokens: 123,
      temperature: 0.25,
      top_p: 0.75,
      stop: ["END"],
      tool_choice: "auto",
      tools: [{ type: "function", function: { name: "lookup", description: "find", parameters: { type: "object", properties: { q: { type: "string" } } } } }],
    });
    expect(converted).toMatchObject({
      max_tokens: 123,
      temperature: 0.25,
      top_p: 0.75,
      stop_sequences: ["END"],
      tool_choice: { type: "auto" },
      tools: [{ name: "lookup", description: "find", input_schema: { type: "object", properties: { q: { type: "string" } } } }],
    });
  });

  test.each(["previous_response_id", "conversation", "background", "text", "metadata"])("rejects unsupported Responses field %s", (field: string) => {
    expect(() => convertRequestBody({
      sourceType: "openai",
      targetType: "claude",
      openAiEndpoint: "responses",
      body: { model: "gpt-5", input: "hi", [field]: field === "background" ? true : "value" },
      model: "claude-opus-4-8",
      stream: false,
    })).toThrow(field);
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

describe("Responses to Claude SSE conversion", () => {
  test("converts text, reasoning, tool arguments, and completion", () => {
    const convert = createSseResponseConverter({
      sourceType: "claude", targetType: "openai", openAiEndpoint: "responses", model: "claude-opus-4-8",
    });
    const output = convert?.([
      "event: response.reasoning_summary_text.delta\ndata: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"internal\"}\n\n",
      "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n",
      "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":1,\"item\":{\"type\":\"function_call\",\"call_id\":\"call_1\",\"name\":\"lookup\"}}\n\n",
      "event: response.function_call_arguments.delta\ndata: {\"type\":\"response.function_call_arguments.delta\",\"output_index\":1,\"item_id\":\"call_1\",\"delta\":\"{\\\"q\\\":\\\"hi\\\"}\"}\n\n",
      "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":3,\"output_tokens\":2}}}\n\n",
    ].join(""), true) ?? "";
    expect(output).toContain("event: message_start");
    expect(output).toContain("\"type\":\"thinking\"");
    expect(output).toContain("\"thinking\":\"internal\"");
    expect(output).toContain("\"text\":\"hello\"");
    expect(output).toContain("\"name\":\"lookup\"");
    expect(output).toContain("\"partial_json\":\"{\\\"q\\\":\\\"hi\\\"}\"");
    expect(output).toContain("event: message_stop");
  });

  test("converts failed Responses streams to a Claude error", () => {
    const convert = createSseResponseConverter({
      sourceType: "claude", targetType: "openai", openAiEndpoint: "responses", model: "claude-opus-4-8",
    });
    const output = convert?.("event: response.failed\ndata: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"bad upstream\"}}}\n\n", true) ?? "";
    expect(output).toContain("event: error");
    expect(output).toContain("bad upstream");
  });
});

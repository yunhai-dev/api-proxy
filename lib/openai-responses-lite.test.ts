// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { normalizeOpenAiRequestBody, withOpenAiSerialTools } from "./openai-responses-lite";

describe("OpenAI serial tool call normalization", () => {
  test("forces serial tool calls for OpenAI text endpoints", () => {
    expect(withOpenAiSerialTools({ parallel_tool_calls: true }, {
      type: "openai",
      openAiEndpoint: "responses",
    })).toEqual({ parallel_tool_calls: false });

    expect(withOpenAiSerialTools({ parallel_tool_calls: true }, {
      type: "openai",
      openAiEndpoint: "chat_completions",
    })).toEqual({ parallel_tool_calls: false });

    expect(withOpenAiSerialTools({ input: "hi" }, {
      type: "openai",
      openAiEndpoint: "responses",
    })).toEqual({ input: "hi", parallel_tool_calls: false });

    expect(withOpenAiSerialTools({ parallel_tool_calls: true }, {
      type: "openai",
      openAiEndpoint: "embeddings",
    })).toEqual({ parallel_tool_calls: true });
  });

  test("normalizes serialized OpenAI request bodies", () => {
    expect(JSON.parse(normalizeOpenAiRequestBody(JSON.stringify({ input: "hi" }), "responses"))).toEqual({ input: "hi", parallel_tool_calls: false });
    expect(JSON.parse(normalizeOpenAiRequestBody(JSON.stringify({ model: "codex-mini", input: "hi", reasoning: { effort: "max", summary: "auto" } }), "responses"))).toEqual({ model: "codex-mini", input: "hi", reasoning: { effort: "max", summary: "auto", context: "all_turns" }, parallel_tool_calls: false });
    expect(normalizeOpenAiRequestBody("not json", "responses")).toBe("not json");
  });
});

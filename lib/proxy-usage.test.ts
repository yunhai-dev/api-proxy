// @ts-expect-error Bun test types are provided by the runtime.
import { describe, expect, test } from "bun:test";
import { openAiInputTokens, openAiOutputTokens } from "./proxy";

describe("OpenAI usage parsing", () => {
  test("falls back to legacy counters when modern aliases are zero", () => {
    const usage = {
      prompt_tokens: 11,
      completion_tokens: 20,
      input_tokens: 0,
      output_tokens: 0,
      prompt_tokens_details: { cached_tokens: 0 },
    };

    expect(openAiInputTokens(usage)).toBe(11);
    expect(openAiOutputTokens(usage)).toBe(20);
  });

  test("prefers non-zero modern counters", () => {
    const usage = {
      prompt_tokens: 99,
      completion_tokens: 99,
      input_tokens: 12,
      output_tokens: 7,
      input_tokens_details: { cached_tokens: 2 },
    };

    expect(openAiInputTokens(usage)).toBe(10);
    expect(openAiOutputTokens(usage)).toBe(7);
  });
});

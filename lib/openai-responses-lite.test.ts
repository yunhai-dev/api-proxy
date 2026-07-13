// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { OPENAI_RESPONSES_LITE_HEADER, withResponsesLiteSerialTools } from "./openai-responses-lite";

describe("OpenAI Responses Lite normalization", () => {
  test("forces serial tool calls only for Codex Responses Lite models", () => {
    const headers = new Headers({ [OPENAI_RESPONSES_LITE_HEADER]: "1" });
    expect(withResponsesLiteSerialTools({ parallel_tool_calls: true }, {
      targetType: "openai",
      openAiEndpoint: "responses",
      incomingHeaders: headers,
      model: "codex-mini",
    })).toEqual({ parallel_tool_calls: false });

    expect(withResponsesLiteSerialTools({ parallel_tool_calls: true }, {
      targetType: "openai",
      openAiEndpoint: "responses",
      incomingHeaders: headers,
      model: "gpt-test",
    })).toEqual({ parallel_tool_calls: true });
  });
});

import type { Provider } from "./upstream";

export const OPENAI_RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";

export function modelRequiresResponsesLiteSerialTools(model: string) {
  return model.toLowerCase().includes("codex");
}

export function shouldNormalizeResponsesLite(input: {
  targetType: Provider;
  openAiEndpoint?: "chat_completions" | "responses" | "embeddings";
  incomingHeaders?: Headers;
  model: string;
}) {
  return input.targetType === "openai"
    && input.openAiEndpoint !== "embeddings";
}

export function withOpenAiSerialTools<T>(body: T, input: { type: Provider; openAiEndpoint?: "chat_completions" | "responses" | "embeddings" }): T {
  if (input.type !== "openai" || input.openAiEndpoint === "embeddings" || !body || typeof body !== "object" || Array.isArray(body)) return body;
  return { ...body, parallel_tool_calls: false };
}

export function withResponsesLiteSerialTools<T>(body: T, input: Parameters<typeof shouldNormalizeResponsesLite>[0]): T {
  return withOpenAiSerialTools(body, { type: input.targetType, openAiEndpoint: input.openAiEndpoint });
}


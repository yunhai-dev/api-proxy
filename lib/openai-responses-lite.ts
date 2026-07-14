import type { Provider } from "./upstream";

export function modelRequiresResponsesLiteSerialTools(model: string) {
  return model.toLowerCase().includes("codex");
}

export function withOpenAiSerialTools<T>(body: T, input: { type: Provider; openAiEndpoint?: "chat_completions" | "responses" | "embeddings"; model?: string }): T {
  if (input.type !== "openai" || input.openAiEndpoint === "embeddings" || !body || typeof body !== "object" || Array.isArray(body)) return body;
  const out = { ...body, parallel_tool_calls: false } as Record<string, unknown>;
  if (input.openAiEndpoint === "responses" && modelRequiresResponsesLiteSerialTools(input.model ?? String(out.model ?? ""))) {
    out.reasoning = { ...(isRecord(out.reasoning) ? out.reasoning : {}), context: "all_turns" };
  }
  return out as T;
}

export function normalizeOpenAiRequestBody(body: string, openAiEndpoint?: "chat_completions" | "responses" | "embeddings") {
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(withOpenAiSerialTools(parsed, { type: "openai", openAiEndpoint, model: isRecord(parsed) ? String(parsed.model ?? "") : "" }));
  } catch {
    return body;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}


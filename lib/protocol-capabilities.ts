import type { OpenAiEndpoint, Provider } from "./upstream";

type Json = Record<string, unknown>;

export type ProtocolCapability =
  | "chat_completions"
  | "responses"
  | "embeddings"
  | "messages"
  | "streaming"
  | "tools"
  | "tool_replay"
  | "vision"
  | "reasoning"
  | "structured_output";

const KNOWN_CAPABILITIES = new Set<ProtocolCapability>([
  "chat_completions",
  "responses",
  "embeddings",
  "messages",
  "streaming",
  "tools",
  "tool_replay",
  "vision",
  "reasoning",
  "structured_output",
]);

export function validateCapabilities(value: unknown) {
  if (value === undefined) return { ok: true as const, capabilities: undefined };
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !KNOWN_CAPABILITIES.has(item as ProtocolCapability))) {
    return { ok: false as const, error: `capabilities 必须为以下值组成的数组：${[...KNOWN_CAPABILITIES].join(", ")}` };
  }
  return { ok: true as const, capabilities: [...new Set(value)] as ProtocolCapability[] };
}

export function requiredCapabilities(input: {
  sourceType: Provider;
  targetType: Provider;
  inboundOpenAiEndpoint?: OpenAiEndpoint;
  upstreamOpenAiEndpoint?: OpenAiEndpoint;
  openAiEndpoint?: OpenAiEndpoint;
  body: Json;
  stream: boolean;
}): ProtocolCapability[] {
  const inboundEndpoint = input.inboundOpenAiEndpoint ?? input.openAiEndpoint;
  const upstreamEndpoint = input.upstreamOpenAiEndpoint ?? (input.targetType === "openai" ? input.openAiEndpoint : undefined);
  const required = new Set<ProtocolCapability>();
  required.add(
    input.targetType === "claude"
      ? "messages"
      : upstreamEndpoint === "responses"
        ? "responses"
        : upstreamEndpoint === "embeddings"
          ? "embeddings"
          : "chat_completions",
  );
  if (input.stream) required.add("streaming");
  if (input.body.tools !== undefined || input.body.tool_choice !== undefined) required.add("tools");
  if (input.sourceType === "openai" && inboundEndpoint === "responses" && Array.isArray(input.body.input) && input.body.input.some(item => isRecord(item) && (item.type === "function_call" || item.type === "function_call_output"))) required.add("tool_replay");
  if (containsImage(input.body)) required.add("vision");
  if (input.body.reasoning_effort !== undefined || (isRecord(input.body.reasoning) && input.body.reasoning.effort !== undefined) || input.body.thinking !== undefined) required.add("reasoning");
  if (input.body.response_format !== undefined || (isRecord(input.body.text) && input.body.text.format !== undefined) || (isRecord(input.body.output_config) && input.body.output_config.format !== undefined)) required.add("structured_output");
  return [...required];
}

export function routeSupportsCapabilities(input: {
  channelCapabilities: string[];
  modelCapabilities: string[];
  sourceType: Provider;
  targetType: Provider;
  inboundOpenAiEndpoint?: OpenAiEndpoint;
  upstreamOpenAiEndpoint?: OpenAiEndpoint;
  required: ProtocolCapability[];
}) {
  if (input.sourceType === input.targetType && input.inboundOpenAiEndpoint === input.upstreamOpenAiEndpoint) return true;
  const supported = new Set([...input.channelCapabilities, ...input.modelCapabilities]);
  return input.required.every(capability => supported.has(capability));
}

function containsImage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsImage);
  if (!isRecord(value)) return false;
  if (value.type === "image" || value.type === "image_url" || value.type === "input_image") return true;
  return Object.values(value).some(containsImage);
}

function isRecord(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

import type { Provider } from "./upstream";

type Json = Record<string, unknown>;
type OpenAiEndpoint = "chat_completions" | "responses" | "embeddings";

export function convertRequestBody(input: {
  sourceType: Provider;
  targetType: Provider;
  openAiEndpoint?: OpenAiEndpoint;
  body: Json;
  model: string;
  stream: boolean;
}): Json {
  if (input.sourceType === input.targetType) return { ...input.body, model: input.model };
  if (input.sourceType === "openai" && input.targetType === "claude") {
    return input.openAiEndpoint === "responses"
      ? openAiResponsesToClaudeMessages(input.body, input.model, input.stream)
      : openAiChatToClaudeMessages(input.body, input.model, input.stream);
  }
  return claudeMessagesToOpenAiChat(input.body, input.model, input.stream);
}

export function convertResponseBody(input: {
  sourceType: Provider;
  targetType: Provider;
  openAiEndpoint?: OpenAiEndpoint;
  body: string;
  model: string;
}): string {
  if (input.sourceType === input.targetType) return input.body;
  const parsed = JSON.parse(input.body) as Json;
  const converted = input.sourceType === "openai"
    ? input.openAiEndpoint === "responses"
      ? claudeMessageToOpenAiResponse(parsed, input.model)
      : claudeMessageToOpenAiChat(parsed, input.model)
    : openAiChatToClaudeMessage(parsed, input.model);
  return JSON.stringify(converted);
}

export function createSseResponseConverter(input: {
  sourceType: Provider;
  targetType: Provider;
  openAiEndpoint?: OpenAiEndpoint;
  model: string;
}) {
  if (input.sourceType === input.targetType) return null;
  if (input.sourceType === "openai") {
    return input.openAiEndpoint === "responses"
      ? createClaudeToOpenAiResponsesSseConverter(input.model)
      : createClaudeToOpenAiSseConverter(input.model);
  }
  return createOpenAiToClaudeSseConverter(input.model);
}

function openAiChatToClaudeMessages(body: Json, model: string, stream: boolean): Json {
  rejectUnsupportedOpenAiChat(body);
  if (!Array.isArray(body.messages)) throw new Error("Chat Completions messages must be an array");
  const system: string[] = [];
  const claudeMessages: unknown[] = [];
  for (const item of body.messages) {
    if (!isRecord(item)) throw new Error("Chat Completions messages must be objects");
    const role = item.role;
    if (role === "system" || role === "developer") {
      system.push(systemTextFromOpenAiContent(item.content, String(role)));
      continue;
    }
    if (role !== "assistant" && role !== "user" && role !== "tool") {
      throw new Error(`Chat Completions role '${String(role)}' is not supported for Claude channels`);
    }
    claudeMessages.push({ role: role === "tool" ? "user" : role, content: openAiMessageContentToClaude(item) });
  }
  const out: Json = {
    model,
    messages: claudeMessages,
    max_tokens: openAiMaxTokens(body),
    stream,
  };
  if (system.length) out.system = system.join("\n\n");
  copyIfPresent(body, out, "temperature");
  copyIfPresent(body, out, "top_p");
  if (body.stop !== undefined) out.stop_sequences = body.stop;
  const tools = openAiToolsToClaude(body.tools);
  if (tools.length) out.tools = tools;
  if (body.tool_choice !== undefined) out.tool_choice = openAiToolChoiceToClaude(body.tool_choice);
  applyOpenAiReasoning(body.reasoning_effort, model, out);
  return out;
}

function openAiResponsesToClaudeMessages(body: Json, model: string, stream: boolean): Json {
  rejectUnsupportedResponses(body);
  const messages = responsesInputToClaudeMessages(body.input);
  const out: Json = {
    model,
    messages,
    max_tokens: numberOrDefault(body.max_output_tokens, 1024),
    stream,
  };
  if (typeof body.instructions === "string" && body.instructions) out.system = body.instructions;
  copyIfPresent(body, out, "temperature");
  copyIfPresent(body, out, "top_p");
  const tools = openAiToolsToClaude(body.tools);
  if (tools.length) out.tools = tools;
  if (body.tool_choice !== undefined) out.tool_choice = openAiToolChoiceToClaude(body.tool_choice);
  const reasoning = isRecord(body.reasoning) ? body.reasoning.effort : undefined;
  applyOpenAiReasoning(reasoning, model, out);
  return out;
}

function rejectUnsupportedOpenAiChat(body: Json) {
  for (const key of ["response_format", "parallel_tool_calls", "stream_options", "logprobs", "top_logprobs", "n", "seed", "presence_penalty", "frequency_penalty", "modalities", "audio", "prediction", "service_tier", "store", "metadata"]) {
    if (body[key] !== undefined) throw new Error(`Chat Completions field '${key}' is not supported for Claude channels`);
  }
  if (body.max_completion_tokens !== undefined && body.max_tokens !== undefined) {
    throw new Error("Only one of max_tokens and max_completion_tokens may be set for Claude channels");
  }
  if (Array.isArray(body.tools) && body.tools.some(tool => !isRecord(tool) || tool.type !== "function")) {
    throw new Error("Only function tools are supported for Claude channels");
  }
}

function rejectUnsupportedResponses(body: Json) {
  for (const key of ["previous_response_id", "conversation", "background", "text", "max_tool_calls", "parallel_tool_calls", "metadata", "store", "include", "service_tier", "truncation", "prompt", "prompt_cache_key", "safety_identifier", "user"]) {
    if (body[key] !== undefined && body[key] !== false) throw new Error(`Responses field '${key}' is not supported for Claude channels`);
  }
  if (Array.isArray(body.tools) && body.tools.some(tool => !isRecord(tool) || tool.type !== "function")) {
    throw new Error("Only function tools are supported for Claude channels");
  }
}

function openAiMaxTokens(body: Json) {
  const maxTokens = body.max_tokens;
  const maxCompletionTokens = body.max_completion_tokens;
  if (maxTokens !== undefined) return numberOrDefault(maxTokens, 1024);
  if (maxCompletionTokens !== undefined) return numberOrDefault(maxCompletionTokens, 1024);
  return 1024;
}

function systemTextFromOpenAiContent(content: unknown, role: string) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error(`Chat Completions ${role} content must be text for Claude channels`);
  return content.map(part => {
    if (!isRecord(part) || (part.type !== "text" && part.type !== "input_text") || typeof part.text !== "string") {
      throw new Error(`Chat Completions ${role} content must contain only text for Claude channels`);
    }
    return part.text;
  }).join("");
}

function responsesInputToClaudeMessages(input: unknown): Json[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) throw new Error("Responses input must be a string or array");
  const messages: Json[] = [];
  for (const item of input) {
    if (!isRecord(item)) throw new Error("Responses input items must be objects");
    if (item.type === "function_call") {
      const callId = requiredString(item.call_id, "Responses function_call call_id");
      const name = requiredString(item.name, "Responses function_call name");
      messages.push({ role: "assistant", content: [{ type: "tool_use", id: callId, name, input: parseRequiredJsonObject(item.arguments, "Responses function_call arguments") }] });
      continue;
    }
    if (item.type === "function_call_output") {
      const callId = requiredString(item.call_id, "Responses function_call_output call_id");
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: callId, content: textFromContent(item.output) }] });
      continue;
    }
    if (item.type === "message" || item.role !== undefined) {
      const role = item.role === "assistant" ? "assistant" : item.role === "user" || item.role === "system" ? item.role : null;
      if (!role) throw new Error(`Responses message role '${String(item.role)}' is not supported`);
      const content = responsesContentToClaude(item.content);
      if (role === "system") throw new Error("Responses system messages must use instructions for Claude channels");
      messages.push({ role, content });
      continue;
    }
    throw new Error(`Responses input item type '${String(item.type ?? "unknown")}' is not supported`);
  }
  return messages;
}

function responsesContentToClaude(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("Responses message content must be a string or array");
  return content.map(part => {
    if (!isRecord(part)) throw new Error("Responses content parts must be objects");
    if (part.type === "input_text" || part.type === "text") return { type: "text", text: String(part.text ?? "") };
    if (part.type === "input_image") {
      const parsed = parseDataUrl(typeof part.image_url === "string" ? part.image_url : "");
      if (!parsed) throw new Error("Only base64 data URL input images are supported for Claude channels");
      return { type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } };
    }
    throw new Error(`Responses content part type '${String(part.type ?? "unknown")}' is not supported`);
  });
}

function applyOpenAiReasoning(value: unknown, model: string, out: Json) {
  if (value === undefined) return;
  if (typeof value !== "string" || !["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)) {
    throw new Error("reasoning effort must be none, minimal, low, medium, high, xhigh, or max");
  }
  const capabilities = claudeReasoningCapabilities(model);
  if (value === "none") {
    if (capabilities.canDisableThinking) out.thinking = { type: "disabled" };
    return;
  }
  const effort = value === "minimal" ? "low" : value;
  out.thinking = { type: "adaptive" };
  const needsCompatibilityFallback = (effort === "xhigh" && !capabilities.supportsXhigh)
    || (effort === "max" && !capabilities.supportsMax);
  out.output_config = { effort: needsCompatibilityFallback ? "high" : effort };
}

function claudeReasoningCapabilities(model: string) {
  const normalized = model.toLowerCase();
  const alwaysAdaptive = normalized.includes("claude-fable-5") || normalized.includes("claude-mythos-5") || normalized.includes("claude-mythos-preview");
  const supportsAdaptive = alwaysAdaptive || normalized.includes("claude-opus-4-8") || normalized.includes("claude-opus-4-7") || normalized.includes("claude-opus-4-6") || normalized.includes("claude-sonnet-5") || normalized.includes("claude-sonnet-4-6");
  const supportsXhigh = alwaysAdaptive || normalized.includes("claude-opus-4-8") || normalized.includes("claude-opus-4-7") || normalized.includes("claude-sonnet-5");
  return { canDisableThinking: supportsAdaptive && !alwaysAdaptive, supportsXhigh, supportsMax: supportsAdaptive };
}

function claudeMessagesToOpenAiChat(body: Json, model: string, stream: boolean): Json {
  const messages: unknown[] = [];
  if (body.system !== undefined) messages.push({ role: "system", content: textFromContent(body.system) });
  for (const item of Array.isArray(body.messages) ? body.messages : []) {
    if (!isRecord(item)) continue;
    messages.push(...claudeMessageToOpenAiMessages(item));
  }
  const out: Json = { model, messages, stream };
  copyIfPresent(body, out, "temperature");
  copyIfPresent(body, out, "top_p");
  if (body.max_tokens !== undefined) out.max_tokens = body.max_tokens;
  if (body.stop_sequences !== undefined) out.stop = body.stop_sequences;
  const tools = claudeToolsToOpenAi(body.tools);
  if (tools.length) out.tools = tools;
  if (body.tool_choice !== undefined) out.tool_choice = claudeToolChoiceToOpenAi(body.tool_choice);
  return out;
}

function claudeMessageToOpenAiChat(body: Json, model: string): Json {
  const contentBlocks = Array.isArray(body.content) ? body.content.filter(isRecord) : [];
  const content = contentBlocks.filter(block => block.type === "text").map(block => String(block.text ?? "")).join("");
  const toolCalls = contentBlocks.filter(block => block.type === "tool_use").map(claudeToolUseToOpenAi).filter(Boolean);
  const usage = isRecord(body.usage) ? body.usage : {};
  const promptTokens = numberOrDefault(usage.input_tokens, 0) + numberOrDefault(usage.cache_read_input_tokens, 0) + numberOrDefault(usage.cache_creation_input_tokens, 0);
  const completionTokens = numberOrDefault(usage.output_tokens, 0);
  const message: Json = { role: "assistant", content: toolCalls.length ? null : content };
  if (toolCalls.length) message.tool_calls = toolCalls;
  return {
    id: typeof body.id === "string" ? body.id : `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: claudeStopReasonToOpenAi(body.stop_reason) }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  };
}

function claudeMessageToOpenAiResponse(body: Json, model: string): Json {
  const contentBlocks = Array.isArray(body.content) ? body.content.filter(isRecord) : [];
  const output: Json[] = [];
  let outputIndex = 0;
  for (const block of contentBlocks) {
    if (block.type === "text") {
      output.push({ id: `msg_${crypto.randomUUID()}`, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: String(block.text ?? ""), annotations: [] }] });
      outputIndex++;
      continue;
    }
    if (block.type === "tool_use") {
      output.push({ id: String(block.id ?? `fc_${crypto.randomUUID()}`), type: "function_call", status: "completed", call_id: String(block.id ?? `call_${crypto.randomUUID()}`), name: String(block.name ?? ""), arguments: JSON.stringify(isRecord(block.input) ? block.input : {}) });
      outputIndex++;
    }
  }
  const usage = isRecord(body.usage) ? body.usage : {};
  const inputTokens = numberOrDefault(usage.input_tokens, 0) + numberOrDefault(usage.cache_read_input_tokens, 0) + numberOrDefault(usage.cache_creation_input_tokens, 0);
  const outputTokens = numberOrDefault(usage.output_tokens, 0);
  const incomplete = body.stop_reason === "max_tokens" ? { reason: "max_output_tokens" } : null;
  return {
    id: typeof body.id === "string" ? body.id : `resp_${crypto.randomUUID()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: incomplete ? "incomplete" : "completed",
    ...(incomplete ? { incomplete_details: incomplete } : {}),
    model,
    output,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
  };
}

function openAiChatToClaudeMessage(body: Json, model: string): Json {
  const choice = Array.isArray(body.choices) && isRecord(body.choices[0]) ? body.choices[0] : {};
  const message = isRecord(choice.message) ? choice.message : {};
  const content = openAiAssistantContentToClaude(message);
  const usage = isRecord(body.usage) ? body.usage : {};
  const inputTokens = numberOrDefault(usage.prompt_tokens, numberOrDefault(usage.input_tokens, 0));
  const outputTokens = numberOrDefault(usage.completion_tokens, numberOrDefault(usage.output_tokens, 0));
  return {
    id: typeof body.id === "string" ? body.id : `msg_${crypto.randomUUID()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: openAiFinishReasonToClaude(choice.finish_reason),
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function createClaudeToOpenAiSseConverter(model: string) {
  let buffer = "";
  let id = `chatcmpl_${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  let sentRole = false;
  const toolIndexes = new Map<number, number>();
  let nextToolIndex = 0;

  return (chunk: string, flush = false) => {
    buffer += chunk;
    const blocks = splitSseBlocks(buffer, flush);
    buffer = blocks.remainder;
    let out = "";
    for (const block of blocks.complete) {
      const data = sseData(block);
      if (!data) continue;
      try {
        const event = JSON.parse(data) as Json;
        if (event.type === "message_start" && isRecord(event.message)) {
          if (typeof event.message.id === "string") id = event.message.id;
          if (!sentRole) {
            out += openAiSse({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
            sentRole = true;
          }
          continue;
        }
        if (event.type === "content_block_delta" && isRecord(event.delta) && event.delta.type === "text_delta") {
          if (!sentRole) {
            out += openAiSse({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
            sentRole = true;
          }
          out += openAiSse({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: String(event.delta.text ?? "") }, finish_reason: null }] });
          continue;
        }
        if (event.type === "content_block_start" && typeof event.index === "number" && isRecord(event.content_block) && event.content_block.type === "tool_use") {
          if (!sentRole) {
            out += openAiSse({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
            sentRole = true;
          }
          const toolIndex = nextToolIndex++;
          toolIndexes.set(event.index, toolIndex);
          out += openAiSse({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: toolIndex, id: String(event.content_block.id ?? `call_${crypto.randomUUID()}`), type: "function", function: { name: String(event.content_block.name ?? ""), arguments: "" } }] }, finish_reason: null }] });
          continue;
        }
        if (event.type === "content_block_delta" && typeof event.index === "number" && isRecord(event.delta) && event.delta.type === "input_json_delta") {
          const toolIndex = toolIndexes.get(event.index);
          if (toolIndex !== undefined) {
            out += openAiSse({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: toolIndex, function: { arguments: String(event.delta.partial_json ?? "") } }] }, finish_reason: null }] });
          }
          continue;
        }
        if (event.type === "message_delta") {
          const usage = isRecord(event.usage) ? claudeUsageToOpenAi(event.usage) : undefined;
          const finishReason = openAiFinishFromClaudeEvent(event.delta);
          if (finishReason || usage) {
            out += openAiSse({ id, object: "chat.completion.chunk", created, model, choices: finishReason ? [{ index: 0, delta: {}, finish_reason: finishReason }] : [], ...(usage ? { usage } : {}) });
          }
          continue;
        }
        if (event.type === "message_stop") out += "data: [DONE]\n\n";
      } catch { /* ignore malformed upstream event */ }
    }
    return out;
  };
}

function createClaudeToOpenAiResponsesSseConverter(model: string) {
  let buffer = "";
  let id = `resp_${crypto.randomUUID()}`;
  let started = false;
  let completed = false;
  let nextOutputIndex = 0;
  let textOutput: { outputIndex: number; contentIndex: number; id: string; text: string } | null = null;
  const toolOutputs = new Map<number, { outputIndex: number; id: string; callId: string; name: string; arguments: string }>();
  let stopReason: unknown = null;
  let usage: Json | null = null;

  function response(status: "in_progress" | "completed" | "incomplete") {
    const output = status === "in_progress" ? [] : [
      ...(textOutput ? [{ id: textOutput.id, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: textOutput.text, annotations: [] }] }] : []),
      ...[...toolOutputs.values()].map(tool => ({ id: tool.id, type: "function_call", status: "completed", call_id: tool.callId, name: tool.name, arguments: tool.arguments })),
    ];
    const incomplete = status === "incomplete" ? { reason: "max_output_tokens" } : null;
    return {
      id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status,
      model,
      output,
      ...(usage ? { usage: claudeUsageToResponses(usage) } : {}),
      ...(incomplete ? { incomplete_details: incomplete } : {}),
    };
  }

  function start() {
    if (started) return "";
    started = true;
    return responsesSse("response.created", { type: "response.created", response: response("in_progress") })
      + responsesSse("response.in_progress", { type: "response.in_progress", response: response("in_progress") });
  }

  function startText() {
    if (textOutput) return "";
    const id = `msg_${crypto.randomUUID()}`;
    textOutput = { outputIndex: nextOutputIndex++, contentIndex: 0, id, text: "" };
    const item = { id, type: "message", status: "in_progress", role: "assistant", content: [] };
    return responsesSse("response.output_item.added", { type: "response.output_item.added", output_index: textOutput.outputIndex, item })
      + responsesSse("response.content_part.added", { type: "response.content_part.added", item_id: item.id, output_index: textOutput.outputIndex, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
  }

  return (chunk: string, flush = false) => {
    buffer += chunk;
    const blocks = splitSseBlocks(buffer, flush);
    buffer = blocks.remainder;
    let out = "";
    for (const block of blocks.complete) {
      const data = sseData(block);
      if (!data) continue;
      try {
        const event = JSON.parse(data) as Json;
        if (event.type === "message_start" && isRecord(event.message)) {
          if (typeof event.message.id === "string") id = event.message.id;
          out += start();
          continue;
        }
        if (event.type === "content_block_delta" && isRecord(event.delta) && event.delta.type === "text_delta") {
          out += start() + startText();
          if (textOutput) {
            const delta = String(event.delta.text ?? "");
            textOutput.text += delta;
            out += responsesSse("response.output_text.delta", { type: "response.output_text.delta", output_index: textOutput.outputIndex, content_index: textOutput.contentIndex, delta });
          }
          continue;
        }
        if (event.type === "content_block_start" && typeof event.index === "number" && isRecord(event.content_block) && event.content_block.type === "tool_use") {
          out += start();
          const tool = { outputIndex: nextOutputIndex++, id: String(event.content_block.id ?? `fc_${crypto.randomUUID()}`), callId: String(event.content_block.id ?? `call_${crypto.randomUUID()}`), name: String(event.content_block.name ?? ""), arguments: "" };
          toolOutputs.set(event.index, tool);
          out += responsesSse("response.output_item.added", { type: "response.output_item.added", output_index: tool.outputIndex, item: { id: tool.id, type: "function_call", status: "in_progress", call_id: tool.callId, name: tool.name, arguments: "" } });
          continue;
        }
        if (event.type === "content_block_delta" && typeof event.index === "number" && isRecord(event.delta) && event.delta.type === "input_json_delta") {
          const tool = toolOutputs.get(event.index);
          if (tool) {
            const delta = String(event.delta.partial_json ?? "");
            tool.arguments += delta;
            out += responsesSse("response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", output_index: tool.outputIndex, item_id: tool.id, delta });
          }
          continue;
        }
        if (event.type === "message_delta") {
          stopReason = isRecord(event.delta) ? event.delta.stop_reason : null;
          usage = isRecord(event.usage) ? event.usage : null;
          continue;
        }
        if (event.type === "message_stop" && !completed) {
          completed = true;
          if (textOutput) {
            const part = { type: "output_text", text: textOutput.text, annotations: [] };
            out += responsesSse("response.content_part.done", { type: "response.content_part.done", output_index: textOutput.outputIndex, content_index: textOutput.contentIndex, part });
            out += responsesSse("response.output_item.done", { type: "response.output_item.done", output_index: textOutput.outputIndex, item: { id: textOutput.id, type: "message", status: "completed", role: "assistant", content: [part] } });
          }
          for (const tool of toolOutputs.values()) {
            out += responsesSse("response.function_call_arguments.done", { type: "response.function_call_arguments.done", output_index: tool.outputIndex, item_id: tool.id, arguments: tool.arguments });
            out += responsesSse("response.output_item.done", { type: "response.output_item.done", output_index: tool.outputIndex, item: { id: tool.id, type: "function_call", status: "completed", call_id: tool.callId, name: tool.name, arguments: tool.arguments } });
          }
          const incomplete = stopReason === "max_tokens";
          out += responsesSse(incomplete ? "response.incomplete" : "response.completed", {
            type: incomplete ? "response.incomplete" : "response.completed",
            response: response(incomplete ? "incomplete" : "completed"),
          });
        }
      } catch { /* ignore malformed upstream event */ }
    }
    return out;
  };
}

function createOpenAiToClaudeSseConverter(model: string) {
  let buffer = "";
  const id = `msg_${crypto.randomUUID()}`;
  let started = false;
  let textBlockIndex: number | null = null;
  let stopped = false;
  const toolCalls = new Map<number, { id: string; name: string; blockIndex: number | null }>();
  let nextContentIndex = 0;
  let pendingStopReason: unknown = null;
  let pendingUsage: unknown = null;

  function start() {
    if (started) return "";
    started = true;
    return claudeSse("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  }

  function startContent() {
    if (textBlockIndex !== null) return "";
    textBlockIndex = nextContentIndex++;
    return claudeSse("content_block_start", { type: "content_block_start", index: textBlockIndex, content_block: { type: "text", text: "" } });
  }

  function emitToolDelta(toolCall: Json) {
    if (typeof toolCall.index !== "number") return "";
    const existing = toolCalls.get(toolCall.index) ?? { id: "", name: "", blockIndex: null };
    const fn = isRecord(toolCall.function) ? toolCall.function : {};
    const id = typeof toolCall.id === "string" ? toolCall.id : existing.id || `call_${crypto.randomUUID()}`;
    const name = typeof fn.name === "string" ? fn.name : existing.name;
    const partialJson = typeof fn.arguments === "string" ? fn.arguments : "";
    let blockIndex = existing.blockIndex;
    let out = "";
    if (blockIndex === null && name) {
      blockIndex = nextContentIndex++;
      out += claudeSse("content_block_start", { type: "content_block_start", index: blockIndex, content_block: { type: "tool_use", id, name, input: {} } });
    }
    toolCalls.set(toolCall.index, { id, name, blockIndex });
    if (blockIndex !== null && partialJson) {
      out += claudeSse("content_block_delta", { type: "content_block_delta", index: blockIndex, delta: { type: "input_json_delta", partial_json: partialJson } });
    }
    return out;
  }

  function stop() {
    if (stopped) return "";
    stopped = true;
    let out = textBlockIndex !== null ? claudeSse("content_block_stop", { type: "content_block_stop", index: textBlockIndex }) : "";
    for (const call of toolCalls.values()) {
      if (call.blockIndex !== null) out += claudeSse("content_block_stop", { type: "content_block_stop", index: call.blockIndex });
    }
    out += claudeSse("message_delta", { type: "message_delta", delta: { stop_reason: openAiFinishReasonToClaude(pendingStopReason ?? "stop"), stop_sequence: null }, usage: openAiUsageToClaude(pendingUsage) });
    return `${out}${claudeSse("message_stop", { type: "message_stop" })}`;
  }

  return (chunk: string, flush = false) => {
    buffer += chunk;
    const blocks = splitSseBlocks(buffer, flush);
    buffer = blocks.remainder;
    let out = "";
    for (const block of blocks.complete) {
      const data = sseData(block);
      if (!data) continue;
      if (data === "[DONE]") {
        out += start() + stop();
        continue;
      }
      try {
        const event = JSON.parse(data) as Json;
        const choice = Array.isArray(event.choices) && isRecord(event.choices[0]) ? event.choices[0] : null;
        if (choice) {
          out += start();
          const delta = isRecord(choice.delta) ? choice.delta : {};
          if (typeof delta.content === "string" && delta.content.length > 0) {
            out += startContent();
            out += claudeSse("content_block_delta", { type: "content_block_delta", index: textBlockIndex ?? 0, delta: { type: "text_delta", text: delta.content } });
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const toolCall of delta.tool_calls) {
              if (isRecord(toolCall)) out += emitToolDelta(toolCall);
            }
          }
          if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
            pendingStopReason = choice.finish_reason;
            if (event.usage !== undefined) pendingUsage = event.usage;
          }
          continue;
        }
        if (isRecord(event.usage)) {
          out += start();
          pendingUsage = event.usage;
        }
      } catch { /* ignore malformed upstream event */ }
    }
    return out;
  };
}

function splitSseBlocks(text: string, flush: boolean) {
  const normalized = text.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const remainder = flush ? "" : parts.pop() ?? "";
  return { complete: flush ? parts.filter(Boolean) : parts.filter(Boolean), remainder };
}

function sseData(block: string) {
  const lines = block.split("\n").filter(line => line.startsWith("data:"));
  if (!lines.length) return "";
  return lines.map(line => line.slice(5).trimStart()).join("\n").trim();
}

function openAiSse(body: Json) {
  return `data: ${JSON.stringify(body)}\n\n`;
}

function responsesSse(event: string, body: Json) {
  return `event: ${event}\ndata: ${JSON.stringify(body)}\n\n`;
}

function claudeSse(event: string, body: Json) {
  return `event: ${event}\ndata: ${JSON.stringify(body)}\n\n`;
}

function openAiFinishFromClaudeEvent(delta: unknown) {
  if (!isRecord(delta) || delta.stop_reason === null || delta.stop_reason === undefined) return null;
  return claudeStopReasonToOpenAi(delta.stop_reason);
}

function claudeUsageToOpenAi(usage: Json) {
  const promptTokens = numberOrDefault(usage.input_tokens, 0) + numberOrDefault(usage.cache_read_input_tokens, 0) + numberOrDefault(usage.cache_creation_input_tokens, 0);
  const completionTokens = numberOrDefault(usage.output_tokens, 0);
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
}

function claudeUsageToResponses(usage: Json) {
  const inputTokens = numberOrDefault(usage.input_tokens, 0) + numberOrDefault(usage.cache_read_input_tokens, 0) + numberOrDefault(usage.cache_creation_input_tokens, 0);
  const outputTokens = numberOrDefault(usage.output_tokens, 0);
  return { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens };
}

function openAiUsageToClaude(usage: unknown) {
  const value = isRecord(usage) ? usage : {};
  const inputTokens = numberOrDefault(value.prompt_tokens, numberOrDefault(value.input_tokens, 0));
  const outputTokens = numberOrDefault(value.completion_tokens, numberOrDefault(value.output_tokens, 0));
  return { input_tokens: inputTokens, output_tokens: outputTokens };
}

function claudeMessageToOpenAiMessages(message: Json): Json[] {
  const role = message.role === "assistant" ? "assistant" : "user";
  const blocks = Array.isArray(message.content) ? message.content.filter(isRecord) : [];
  if (role === "assistant") {
    const content = blocks.filter(block => block.type !== "tool_use");
    const toolCalls = blocks.filter(block => block.type === "tool_use").map(claudeToolUseToOpenAi).filter(Boolean);
    const out: Json = { role: "assistant", content: toolCalls.length ? textFromContent(content) || null : claudeContentToOpenAi(message.content) };
    if (toolCalls.length) out.tool_calls = toolCalls;
    return [out];
  }

  const out: Json[] = [];
  const toolResultBlocks = blocks.filter(block => block.type === "tool_result");
  const userBlocks = blocks.filter(block => block.type !== "tool_result");
  for (const block of toolResultBlocks) {
    out.push({ role: "tool", tool_call_id: String(block.tool_use_id ?? ""), content: textFromContent(block.content) });
  }
  if (userBlocks.length || !blocks.length) out.push({ role: "user", content: claudeContentToOpenAi(blocks.length ? userBlocks : message.content) });
  return out;
}

function openAiMessageContentToClaude(message: Json): unknown {
  if (message.role === "tool") {
    return [{ type: "tool_result", tool_use_id: requiredString(message.tool_call_id, "Chat Completions tool_call_id"), content: textFromContent(message.content) }];
  }
  if (message.role === "assistant") return openAiAssistantContentToClaude(message);
  return openAiContentToClaude(message.content);
}

function openAiAssistantContentToClaude(message: Json): unknown[] {
  const content: unknown[] = [];
  const text = textFromContent(message.content);
  if (text) content.push({ type: "text", text });
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!isRecord(call) || call.type !== "function" || !isRecord(call.function)) {
        throw new Error("Chat Completions assistant tool_calls must be function calls");
      }
      content.push({
        type: "tool_use",
        id: requiredString(call.id, "Chat Completions tool_call id"),
        name: requiredString(call.function.name, "Chat Completions tool_call function name"),
        input: parseRequiredJsonObject(call.function.arguments, "Chat Completions tool_call arguments"),
      });
    }
  }
  return content.length ? content : [{ type: "text", text: "" }];
}

function openAiToolsToClaude(tools: unknown): unknown[] {
  if (tools === undefined) return [];
  if (!Array.isArray(tools)) throw new Error("OpenAI tools must be an array");
  return tools.map(tool => {
    if (!isRecord(tool) || tool.type !== "function" || !isRecord(tool.function)) {
      throw new Error("Only function tools are supported for Claude channels");
    }
    return {
      name: requiredString(tool.function.name, "OpenAI function tool name"),
      description: typeof tool.function.description === "string" ? tool.function.description : undefined,
      input_schema: requiredJsonObject(tool.function.parameters, "OpenAI function tool parameters"),
    };
  });
}

function claudeToolsToOpenAi(tools: unknown): unknown[] {
  if (tools === undefined) return [];
  if (!Array.isArray(tools)) throw new Error("Claude tools must be an array");
  return tools.map(tool => {
    if (!isRecord(tool)) throw new Error("Claude tools must be objects");
    return {
      type: "function",
      function: {
        name: requiredString(tool.name, "Claude tool name"),
        description: typeof tool.description === "string" ? tool.description : undefined,
        parameters: requiredJsonObject(tool.input_schema, "Claude tool input_schema"),
      },
    };
  });
}

function openAiToolChoiceToClaude(choice: unknown): unknown {
  if (choice === "required") return { type: "any" };
  if (choice === "auto" || choice === "none" || choice === "any") return { type: choice === "none" ? "none" : choice };
  if (isRecord(choice) && isRecord(choice.function)) return { type: "tool", name: String(choice.function.name ?? "") };
  return choice;
}

function claudeToolChoiceToOpenAi(choice: unknown): unknown {
  if (!isRecord(choice)) return choice;
  if (choice.type === "auto" || choice.type === "none") return choice.type;
  if (choice.type === "any") return "required";
  if (choice.type === "tool") return { type: "function", function: { name: String(choice.name ?? "") } };
  return choice;
}

function claudeToolUseToOpenAi(block: Json): Json | null {
  if (block.type !== "tool_use") return null;
  return {
    id: String(block.id ?? `call_${crypto.randomUUID()}`),
    type: "function",
    function: { name: String(block.name ?? ""), arguments: JSON.stringify(isRecord(block.input) ? block.input : {}) },
  };
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requiredJsonObject(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function parseRequiredJsonObject(value: unknown, label: string) {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a JSON object`);
  try {
    return requiredJsonObject(JSON.parse(value), label);
  } catch (error) {
    if (error instanceof Error && error.message === `${label} must be an object`) throw error;
    throw new Error(`${label} must be a JSON object`);
  }
}

function openAiContentToClaude(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("Chat Completions content must be a string or array");
  return content.map(part => {
    if (!isRecord(part)) throw new Error("Chat Completions content parts must be objects");
    if (part.type === "text" || part.type === "input_text") {
      if (typeof part.text !== "string") throw new Error("Chat Completions text content must be a string");
      return { type: "text", text: part.text };
    }
    if (part.type === "image_url" && isRecord(part.image_url)) {
      const parsed = parseDataUrl(typeof part.image_url.url === "string" ? part.image_url.url : "");
      if (!parsed) throw new Error("Only base64 data URL images are supported for Claude channels");
      return { type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } };
    }
    throw new Error(`Chat Completions content part type '${String(part.type ?? "unknown")}' is not supported for Claude channels`);
  });
}

function claudeContentToOpenAi(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("Claude content must be a string or array");
  return content.map(part => {
    if (!isRecord(part)) throw new Error("Claude content blocks must be objects");
    if (part.type === "text") {
      if (typeof part.text !== "string") throw new Error("Claude text blocks must contain text");
      return { type: "text", text: part.text };
    }
    if (part.type === "image" && isRecord(part.source)) {
      const mediaType = requiredString(part.source.media_type, "Claude image media_type");
      const data = requiredString(part.source.data, "Claude image data");
      return { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } };
    }
    throw new Error(`Claude content block type '${String(part.type ?? "unknown")}' is not supported for OpenAI channels`);
  });
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content.filter(isRecord).map(part => String(part.text ?? "")).join("");
}

function parseDataUrl(url: string) {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

function copyIfPresent(from: Json, to: Json, key: string) {
  if (from[key] !== undefined) to[key] = from[key];
}

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function claudeStopReasonToOpenAi(reason: unknown) {
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "tool_calls";
  return "stop";
}

function openAiFinishReasonToClaude(reason: unknown) {
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls") return "tool_use";
  return "end_turn";
}

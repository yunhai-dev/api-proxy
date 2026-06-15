import type { Provider } from "./upstream";

type Json = Record<string, unknown>;

export function convertRequestBody(input: {
  sourceType: Provider;
  targetType: Provider;
  body: Json;
  model: string;
  stream: boolean;
}): Json {
  if (input.sourceType === input.targetType) return { ...input.body, model: input.model };
  if (input.sourceType === "openai" && input.targetType === "claude") {
    return openAiChatToClaudeMessages(input.body, input.model, input.stream);
  }
  return claudeMessagesToOpenAiChat(input.body, input.model, input.stream);
}

export function convertResponseBody(input: {
  sourceType: Provider;
  targetType: Provider;
  body: string;
  model: string;
}): string {
  if (input.sourceType === input.targetType) return input.body;
  const parsed = JSON.parse(input.body) as Json;
  const converted = input.sourceType === "openai"
    ? claudeMessageToOpenAiChat(parsed, input.model)
    : openAiChatToClaudeMessage(parsed, input.model);
  return JSON.stringify(converted);
}

export function createSseResponseConverter(input: {
  sourceType: Provider;
  targetType: Provider;
  model: string;
}) {
  if (input.sourceType === input.targetType) return null;
  return input.sourceType === "openai"
    ? createClaudeToOpenAiSseConverter(input.model)
    : createOpenAiToClaudeSseConverter(input.model);
}

function openAiChatToClaudeMessages(body: Json, model: string, stream: boolean): Json {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system: unknown[] = [];
  const claudeMessages: unknown[] = [];
  for (const item of messages) {
    if (!isRecord(item)) continue;
    const role = item.role === "assistant" ? "assistant" : item.role === "system" ? "system" : "user";
    const content = openAiMessageContentToClaude(item);
    if (role === "system") system.push(content);
    else claudeMessages.push({ role, content });
  }
  const out: Json = {
    model,
    messages: claudeMessages,
    max_tokens: numberOrDefault(body.max_tokens, 1024),
    stream,
  };
  if (system.length === 1) out.system = system[0];
  if (system.length > 1) out.system = system.map(textFromContent).join("\n\n");
  copyIfPresent(body, out, "temperature");
  copyIfPresent(body, out, "top_p");
  if (body.stop !== undefined) out.stop_sequences = body.stop;
  const tools = openAiToolsToClaude(body.tools);
  if (tools.length) out.tools = tools;
  if (body.tool_choice !== undefined) out.tool_choice = openAiToolChoiceToClaude(body.tool_choice);
  return out;
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
  const userBlocks = blocks.filter(block => block.type !== "tool_result");
  if (userBlocks.length || !blocks.length) out.push({ role: "user", content: claudeContentToOpenAi(blocks.length ? userBlocks : message.content) });
  for (const block of blocks.filter(block => block.type === "tool_result")) {
    out.push({ role: "tool", tool_call_id: String(block.tool_use_id ?? ""), content: textFromContent(block.content) });
  }
  return out;
}

function openAiMessageContentToClaude(message: Json): unknown {
  if (message.role === "tool") {
    return [{ type: "tool_result", tool_use_id: String(message.tool_call_id ?? ""), content: textFromContent(message.content) }];
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
      if (!isRecord(call)) continue;
      const fn = isRecord(call.function) ? call.function : {};
      content.push({
        type: "tool_use",
        id: String(call.id ?? `call_${crypto.randomUUID()}`),
        name: String(fn.name ?? ""),
        input: parseJsonObject(fn.arguments),
      });
    }
  }
  return content.length ? content : [{ type: "text", text: "" }];
}

function openAiToolsToClaude(tools: unknown): unknown[] {
  if (!Array.isArray(tools)) return [];
  return tools.map(tool => {
    if (!isRecord(tool) || tool.type !== "function" || !isRecord(tool.function)) return null;
    return {
      name: String(tool.function.name ?? ""),
      description: typeof tool.function.description === "string" ? tool.function.description : undefined,
      input_schema: isRecord(tool.function.parameters) ? tool.function.parameters : { type: "object", properties: {} },
    };
  }).filter(Boolean);
}

function claudeToolsToOpenAi(tools: unknown): unknown[] {
  if (!Array.isArray(tools)) return [];
  return tools.map(tool => {
    if (!isRecord(tool)) return null;
    return {
      type: "function",
      function: {
        name: String(tool.name ?? ""),
        description: typeof tool.description === "string" ? tool.description : undefined,
        parameters: isRecord(tool.input_schema) ? tool.input_schema : { type: "object", properties: {} },
      },
    };
  }).filter(Boolean);
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

function parseJsonObject(value: unknown) {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch { return {}; }
}

function openAiContentToClaude(content: unknown): unknown {
  if (!Array.isArray(content)) return typeof content === "string" ? content : String(content ?? "");
  return content.map(part => {
    if (!isRecord(part)) return { type: "text", text: String(part ?? "") };
    if (part.type === "image_url" && isRecord(part.image_url)) {
      const parsed = parseDataUrl(typeof part.image_url.url === "string" ? part.image_url.url : "");
      return parsed ? { type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } } : { type: "text", text: "" };
    }
    return { type: "text", text: String(part.text ?? "") };
  });
}

function claudeContentToOpenAi(content: unknown): unknown {
  if (!Array.isArray(content)) return typeof content === "string" ? content : String(content ?? "");
  return content.map(part => {
    if (!isRecord(part)) return { type: "text", text: String(part ?? "") };
    if (part.type === "image" && isRecord(part.source)) {
      const mediaType = typeof part.source.media_type === "string" ? part.source.media_type : "image/png";
      const data = typeof part.source.data === "string" ? part.source.data : "";
      return { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } };
    }
    return { type: "text", text: String(part.text ?? "") };
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

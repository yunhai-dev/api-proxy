const baseUrl = process.env.API_PROXY_SMOKE_BASE_URL?.replace(/\/+$/, "");
const relayKey = process.env.API_PROXY_SMOKE_RELAY_KEY;

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const configuredBaseUrl = required("API_PROXY_SMOKE_BASE_URL", baseUrl);
const configuredRelayKey = required("API_PROXY_SMOKE_RELAY_KEY", relayKey);

async function post(label, path, body, headers = {}) {
  const response = await fetch(`${configuredBaseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${configuredRelayKey}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} ${await response.text()}`);
  console.log(`${label}: ok`);
}

async function stream(label, path, body, marker, headers = {}) {
  const response = await fetch(`${configuredBaseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${configuredRelayKey}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ ...body, stream: true }),
  });
  const text = await response.text();
  if (!response.ok || !text.includes(marker)) throw new Error(`${label}: invalid stream response`);
  console.log(`${label}: ok`);
}

await post("messages", "/v1/messages", {
  model: required("API_PROXY_SMOKE_CLAUDE_MODEL", process.env.API_PROXY_SMOKE_CLAUDE_MODEL),
  max_tokens: 1,
  messages: [{ role: "user", content: "ping" }],
}, { "anthropic-version": "2023-06-01" });

const openAiModel = required("API_PROXY_SMOKE_OPENAI_MODEL", process.env.API_PROXY_SMOKE_OPENAI_MODEL);
await post("chat completions", "/v1/chat/completions", {
  model: openAiModel,
  max_completion_tokens: 1,
  messages: [{ role: "user", content: "ping" }],
});
await post("responses", "/v1/responses", {
  model: openAiModel,
  max_output_tokens: 1,
  input: "ping",
});
await post("embeddings", "/v1/embeddings", {
  model: required("API_PROXY_SMOKE_EMBEDDING_MODEL", process.env.API_PROXY_SMOKE_EMBEDDING_MODEL),
  input: "ping",
});

if (process.env.API_PROXY_SMOKE_BRIDGE === "1") {
  await post("chat to Claude bridge", "/v1/chat/completions", {
    model: required("API_PROXY_SMOKE_CHAT_TO_CLAUDE_MODEL", process.env.API_PROXY_SMOKE_CHAT_TO_CLAUDE_MODEL),
    max_completion_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
  });
  await post("Messages to OpenAI bridge", "/v1/messages", {
    model: required("API_PROXY_SMOKE_MESSAGES_TO_OPENAI_MODEL", process.env.API_PROXY_SMOKE_MESSAGES_TO_OPENAI_MODEL),
    max_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
  }, { "anthropic-version": "2023-06-01" });
}

if (process.env.API_PROXY_SMOKE_STREAM === "1") {
  await stream("messages stream", "/v1/messages", {
    model: process.env.API_PROXY_SMOKE_CLAUDE_MODEL,
    max_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
  }, "data:", { "anthropic-version": "2023-06-01" });
  await stream("chat completions stream", "/v1/chat/completions", {
    model: openAiModel,
    max_completion_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
  }, "data:");
}

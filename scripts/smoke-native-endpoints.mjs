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

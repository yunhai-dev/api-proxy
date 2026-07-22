# Tavily MCP Proxy Design Document

## Background & Goals

- Problem: Tavily 原生 MCP 需要 `https://mcp.tavily.com/mcp/?tavilyApiKey=<native-key>`，客户端不应拿到原生 Tavily key。
- Goal: 客户端使用本平台 Base URL + 平台 Relay Key；平台从内部 Tavily channel key 池选择原生 key 后透传 MCP 请求。
- Success: URL 参数或请求头传平台 key 都可用，原生 Tavily key 只在服务端注入上游请求。

## High-Level Design

- Reuse `channels` as Tavily API Key pool by adding `type=tavily`.
- Add `app/mcp/tavily/route.ts` as a raw MCP pass-through endpoint.
- Reuse `resolveApiKeyAsync` from `lib/proxy.ts` for platform key auth.
- Do not reuse `proxyOnce`; it requires LLM model JSON and protocol conversion.

## Implementation Plan

### Stage 1: Channel pool support

- **Files modified**: `lib/db/pg-schema.ts`, `app/api/channels/route.ts`, `app/api/channels/[id]/route.ts`, `components/channels/channel-form.tsx`, `components/keys/key-form.tsx`, `app/api/keys/route.ts`
- **Specific logic**:
  - Allow channel `type` value `tavily`.
  - Let admin create/edit Tavily channels with base URL, API key, weight, enabled state.
  - Add `tavily` to key channel scope validation and UI.
  - For Tavily channel forms, default base URL to `https://mcp.tavily.com/mcp/` and models to `*`.
- **Validation**: Admin can create a Tavily channel and create a relay key scoped to Tavily.

### Stage 2: MCP pass-through route

- **Files modified**: `app/mcp/tavily/route.ts`
- **Specific logic**:
  - Support `GET`, `POST`, `DELETE`, `OPTIONS`.
  - Accept platform key from URL params (`key`, `apiKey`, or `token`) or headers (`Authorization`, `x-api-key`, `api-key`).
  - Validate relay key with `resolveApiKeyAsync`.
  - Reject keys whose `channelScope` is not `all` or `tavily`.
  - Select an enabled Tavily channel, honoring bound `channelId`, using simple weighted random.
  - Forward to Tavily with `tavilyApiKey=<channel.apiKey>` generated server-side.
  - Strip platform auth/query params before upstream; never forward client `tavilyApiKey`.
  - Return upstream response body as a stream.
- **Validation**: MCP client works with either `?key=<sk-relay-key>` or `Authorization: Bearer <sk-relay-key>`.

### Stage 3: Tavily usage observation

- **Files modified**: `app/mcp/tavily/route.ts`, `app/api/channels/route.ts`, `components/channels/channels-table.tsx`
- **Specific logic**:
  - Extract remaining/quota/used from Tavily response headers when present.
  - For non-stream JSON responses, read `usage.credits` from a cloned response and store it as recent credit consumption.
  - Persist observations in `settings` with key `tavily_usage:<channelId>`.
  - Add `tavilyUsage` to Tavily channel API rows and show compact usage text in the channel table.
- **Validation**: Tavily responses keep streaming normally; usage parsing failure never breaks the proxied response.

### Stage 4: Verification

- **Files modified**: docs only if status needs update after validation.
- **Specific logic**:
  - Run `bunx tsc --noEmit`.
  - Smoke test successful Tavily MCP tool list/search with configured native Tavily channel.
  - Negative tests: missing key, invalid key, forbidden scope, no Tavily channel, missing usage headers/body.
- **Validation**: Existing `/v1/messages`, `/v1/chat/completions`, `/v1/responses` still type-check.

## Testing Strategy

- Happy path: Tavily channel enabled + platform key via query param and header; usage headers update channel usage.
- Error path: missing platform key, invalid platform key, key scoped to `claude`/`openai`, disabled/no Tavily channels.
- Usage path: missing usage data does nothing; JSON `usage.credits` records recent credit consumption.
- Regression: existing Claude/OpenAI channel creation and key creation still compile.

## Risks & Mitigation

- Risk: Existing channel health checker assumes LLM requests. Mitigation: Tavily channels should set monitor interval `0`; no Tavily health check in this version.
- Risk: URL key names might collide with MCP params. Mitigation: support short `key`/`apiKey`/`token` and strip them before upstream.
- Rollback: remove `/mcp/tavily` route and stop creating `type=tavily` channels.
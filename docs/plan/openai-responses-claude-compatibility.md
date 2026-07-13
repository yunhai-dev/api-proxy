# OpenAI Responses → Claude Compatibility Design Document

## Background & Goals

The `/v1/responses` route already forwards same-provider OpenAI requests unchanged, but OpenAI-to-Claude conversion previously assumed Chat Completions fields. Cross-provider Responses requests therefore lost `input`, `instructions`, and `reasoning.effort`, while Claude results were returned as Chat Completions JSON or chunks.

Success criteria:

- Convert stateless OpenAI Responses text/image/function-tool requests to Claude Messages.
- Map `reasoning.effort` and Chat Completions `reasoning_effort` to Claude adaptive thinking plus `output_config.effort`; never synthesize `budget_tokens`. The supported OpenAI values and compatibility behavior are defined below.
- Return Responses objects and Responses SSE events to `/v1/responses` callers when the selected upstream is Claude.
- Preserve existing Chat Completions conversion and same-provider Responses pass-through.
- Reject unsupported cross-provider Responses features before an upstream call.

## High-Level Design

`app/v1/responses/route.ts` continues to set `openAiEndpoint: "responses"` on `proxyOnce`. `lib/proxy.ts` forwards that endpoint context to all three conversion seams: request construction, non-stream response conversion, and SSE conversion. The shared request conversion path is used by both regular and fallback channels.

`lib/protocol-conversion.ts` keeps the existing Chat Completions adapters and selects Responses-specific adapters only for OpenAI inbound Responses traffic routed to Claude. Same-provider traffic returns its original body and SSE stream untouched.

## Implementation Plan

### Stage 1: Endpoint-aware conversion plumbing

- **Files modified**: `lib/proxy.ts`, `lib/protocol-conversion.ts`.
- **Specific logic**: Add OpenAI endpoint context to `convertRequestBody`, `convertResponseBody`, and `createSseResponseConverter`; supply it from regular, fallback, JSON, and stream paths.
- **Validation**: `bunx tsc --noEmit` passes; both regular and fallback paths use the same endpoint value.

### Stage 2: Responses request conversion and reasoning mapping

- **Files modified**: `lib/protocol-conversion.ts`.
- **Specific logic**: Convert `instructions`, string/array `input`, base64 input images, function-call outputs, function tools, and output-token settings into a Claude Messages body. Map valid qualitative effort values to adaptive thinking and output effort. Reject unsupported stateful/background/non-function-tool fields.
- **Validation**: Type-check plus representative route validation with a configured Claude channel.

### Stage 3: Responses result conversion

- **Files modified**: `lib/protocol-conversion.ts`.
- **Specific logic**: Convert Claude Messages JSON to a Responses envelope with output text/function-call items. Add a separate Claude-SSE-to-Responses state machine which emits lifecycle, text delta, function-call argument delta, item completion, and response completion events. Chat chunk conversion remains unchanged.
- **Validation**: Type-check and stream/non-stream requests through `/v1/responses`.

### Stage 4: Proxy error handling

- **Files modified**: `lib/proxy.ts`.
- **Specific logic**: Treat conversion/preflight exceptions as client `400` failures, so invalid cross-provider Responses payloads are not retried or sent to fallback channels.
- **Validation**: Submit an unsupported Responses payload and confirm no upstream channel is attempted.

## Reasoning-effort compatibility

Both OpenAI ingress fields accept `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`:

| OpenAI value | Claude behavior |
|---|---|
| `none` | Sends `thinking: { type: "disabled" }` for known Claude models that support disabling; omits thinking controls for Fable 5/Mythos families and unknown Claude-compatible models, where disabled thinking is unsafe or invalid. |
| `minimal` | Adaptive thinking with `output_config.effort: "low"`. |
| `low` / `medium` / `high` | Adaptive thinking with the same effort value. |
| `xhigh` | Adaptive thinking with `xhigh` for Claude Fable 5/Mythos 5, Opus 4.8/4.7, and Sonnet 5; otherwise downgrades to `high`. |
| `max` | Adaptive thinking with `max` for documented adaptive-thinking Claude families; otherwise downgrades to `high`. |

This policy is recalculated using each selected route’s resolved upstream model, including fallback. Unknown values or non-string fields return `400`. The implementation deliberately does not map `reasoning.summary`, `reasoning.context_mode`, or Responses reasoning output items: they are separate output/state features, not effort controls.

## Testing Strategy

- `bunx tsc --noEmit` and `bun run build`.
- `/v1/responses` → Claude: non-stream text, stream text, function tool call, and function-call-output follow-up.
- Confirm `reasoning.effort` produces Claude adaptive thinking plus output effort, with no `budget_tokens`.
- Force a fallback Claude route and confirm it uses the same conversion.
- Regress `/v1/chat/completions` → Claude with `reasoning_effort`.
- Confirm OpenAI → OpenAI Responses non-stream/stream remain pass-through.
- Confirm invalid effort and unsupported Responses state/tool fields return `400` without an upstream request.

## Risks & Mitigation

- Claude-compatible third-party channels can reject adaptive thinking or output effort. These remain upstream errors; the proxy does not emulate effort with token budgets.
- Responses includes features without a faithful Claude equivalent. Cross-provider conversion rejects them rather than silently losing state or tool behavior.
- Reasoning content is not exposed unless a safe, explicit summary representation is available; no hidden reasoning or signatures are fabricated.
- Reverting the endpoint-aware conversion branches restores prior Chat behavior and same-provider Responses forwarding without a schema migration.

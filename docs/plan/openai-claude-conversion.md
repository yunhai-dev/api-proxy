# OpenAI/Claude Protocol Conversion Design Document

## Background & Goals
- Problem to solve: the proxy currently treats the inbound API protocol and upstream channel provider as the same value, so an OpenAI-compatible client can only call OpenAI-style upstreams and a Claude-compatible client can only call Claude-style upstreams.
- Success criteria: model mappings can explicitly route an inbound provider/model to a different upstream provider/model, and non-stream text requests return responses in the caller's original protocol.
- Success criteria: existing same-provider mappings and direct proxy calls continue to behave as before.

## High-Level Design
- Add `targetProvider` to model mappings. `provider` remains the inbound/client protocol. `targetProvider` is the upstream channel protocol and defaults to `provider` for existing mappings.
- Add a protocol conversion helper module for request and non-stream response bodies.
- Update proxy routing so channel selection and upstream calls use `targetProvider`, while validation, logging details, and client response format keep the inbound `provider`.
- Data flow: inbound route sets `req.type` -> model mapping resolves `targetProvider` -> request body is converted if providers differ -> upstream is called using target provider -> response body is converted back to inbound provider if providers differ.

## Implementation Plan

### Stage 1: Mapping Data Model
- **Files modified**: `lib/db/pg-schema.ts`, `scripts/init-postgres-schema.mjs`, `app/api/model-mappings/route.ts`, `app/api/model-mappings/[id]/route.ts`.
- **Specific logic**: add `target_provider` with a same-provider default, include it in create/update/list payloads, and validate bound channels against `targetProvider` instead of inbound `provider`.
- **Validation**: typecheck and create/edit one same-provider mapping and one cross-provider mapping.

### Stage 2: Mapping UI
- **Files modified**: `components/mappings/mappings-table.tsx`.
- **Specific logic**: add an upstream provider selector, filter upstream model/channel options by target provider, display inbound and upstream providers separately.
- **Validation**: confirm the modal can choose `openai -> claude` and the table shows both sides.

### Stage 3: Conversion Helpers
- **Files modified**: `lib/protocol-conversion.ts`.
- **Specific logic**: implement OpenAI Chat Completions to Claude Messages conversion, Claude Messages to OpenAI Chat Completions conversion, and non-stream response conversion in the reverse direction.
- **Validation**: typecheck and inspect representative converted JSON with local requests.

### Stage 4: Proxy Integration
- **Files modified**: `lib/proxy.ts`.
- **Specific logic**: resolve target provider from mapping, select target channels, call target endpoint, log actual upstream provider, and convert non-stream response bodies back to the inbound protocol.
- **Validation**: same-provider requests still work; cross-provider non-stream requests return the caller's expected response shape.

## Testing Strategy
- Happy path tests: OpenAI non-stream text request to Claude upstream; Claude non-stream text request to OpenAI upstream; existing same-provider mapping.
- Error path tests: missing model, target channel not found, channel type mismatch on mapping save, malformed JSON body.
- Regression scope: model mappings CRUD, channel selection, model catalog enable/disable checks, request logs and usage accounting.

## Risks & Mitigation
- Risk: stream protocol conversion is more complex than non-stream conversion. Mitigation: keep stream conversion out of the MVP unless the non-stream path is stable.
- Risk: unsupported provider-specific fields may be silently dropped. Mitigation: only map common fields and keep unsupported-field behavior limited to cross-provider conversion.
- Rollback plan: same-provider mappings remain compatible because `targetProvider` defaults to `provider`; removing cross-provider mappings restores current behavior.

# Enterprise Native API and Protocol-Bridge Design Document

## Background & Goals

The gateway exposes Claude Messages plus OpenAI Chat Completions, Responses, and Embeddings through `proxyOnce`. Same-provider traffic is pass-through apart from model routing; cross-provider traffic is converted in `lib/protocol-conversion.ts`.

The bridge currently supports a useful subset, but some valid request and response semantics can be silently changed or lost. The first goal is therefore correctness: bridge traffic must either retain a documented semantic equivalent or fail before an upstream request. The broader goal is to make routing, reliability, observability, and configuration capability-aware without replacing the existing two-provider architecture.

Success criteria:

- Native OpenAI and Claude requests retain their protocol payload, streaming contract, and supported version/header features.
- Cross-provider routing rejects unrepresentable semantics with provider-shaped client errors instead of silently dropping fields.
- Channel and model capabilities determine whether a primary or fallback route is eligible.
- Retries, streaming commitment, quotas, health, redaction, and logs remain reliable across native and bridge paths.
- Contract fixtures verify JSON, SSE, error, header, and route-selection behavior.

## High-Level Design

The existing request flow remains the foundation:

```text
/v1 route → proxyOnce → mapping/channel selection → request preflight/conversion
          → callUpstream → response/SSE conversion → logging/accounting
```

Native traffic continues through the same route and proxy flow but bypasses protocol conversion. Cross-provider traffic gains a preflight step that extracts required features and validates them against a compact capability profile. `lib/protocol-conversion.ts` remains the sole translation boundary; route handlers do not acquire protocol-specific transformations.

Capability data is managed at channel and model scope. The profile uses validated known keys for endpoint/API flavor, streaming, media, tools, structured output, reasoning, and headers. `proxyOnce` filters regular and fallback candidates using the same required-feature set before weight, health, and saturation selection.

## Implementation Plan

### Stage 1: Contract baseline and strict bridge preflight

- **Files modified**: `lib/protocol-conversion.ts`, `lib/proxy.ts`, `app/v1/messages/route.ts`, `app/v1/chat/completions/route.ts`, `app/v1/responses/route.ts`, `app/v1/embeddings/route.ts`, focused test fixtures, `README.md`.
- **Specific logic**:
  - Define endpoint and feature vocabulary at the conversion boundary.
  - Add request validation for cross-provider calls before conversion/upstream selection.
  - Preserve existing provider-specific error envelopes and `x-request-id`.
  - Reject remote media URLs, unsupported structured output, unsupported tool controls, and nonrepresentable roles/content rather than emitting empty/default values.
  - Extract only shared route parsing, stream detection, authorization extraction, and error rendering where it avoids route drift.
- **Validation**:
  - Native request JSON/SSE stays transparent.
  - Unsupported bridge request returns 4xx and mock upstream call count is zero.
  - Existing Chat, Responses, and Embeddings paths continue to route correctly.

### Stage 2: Complete supported conversion adapters

- **Files modified**: `lib/protocol-conversion.ts`, `lib/protocol-conversion.test.ts`, new JSON/SSE fixture files.
- **Specific logic**:
  - Handle OpenAI `developer` instructions with a defined system ordering policy.
  - Add Responses historical `function_call` replay and validate function-call output correlation.
  - Make request/response content and tool conversion strict in both directions.
  - Complete endpoint-specific SSE state machines: usage, stop reason, incomplete/error status, tool argument deltas, and exact terminal payloads.
  - Reject an OpenAI Responses stream toward Claude until a dedicated adapter is complete.
- **Validation**:
  - Golden JSON/SSE fixtures cover Messages↔Chat, Messages↔Responses, tools, replay, base64 images, reasoning effort, terminal states, and unsupported inputs.

### Stage 3: Capability-aware routing and administration

- **Files modified**: `lib/db/pg-schema.ts`, Drizzle migration/init artifacts, `lib/model-catalog.ts`, `lib/proxy.ts`, channel/model/mapping APIs, config import/export, and management UI components.
- **Specific logic**:
  - Add validated JSON capability profiles at channel/model scope with conservative defaults.
  - Surface profiles through CRUD, import/export, and model discovery.
  - Filter primary and fallback candidates by endpoint/stream/request/output capability requirements before normal routing selection.
  - Replace model-name reasoning heuristics with profile data.
- **Validation**:
  - Schema migration and admin validation succeed.
  - Incompatible primary/fallback channels are excluded without upstream calls.
  - Existing compatible weight and health behavior is unchanged.

### Stage 4: Native transport and operational reliability

- **Files modified**: `lib/upstream.ts`, `lib/proxy.ts`, `lib/channel-health.ts`, `lib/channel-queue.ts`, `lib/key-queue.ts`, `lib/rate-limit.ts`, `lib/log-generator.ts`, settings/admin surfaces.
- **Specific logic**:
  - Use a controlled header allowlist with credential replacement and configurable provider version/beta handling.
  - Classify aborts, transport errors, timeouts, throttling, 5xx, malformed responses, conversion errors, and empty output.
  - Restrict retries/fallback to the period before client-visible stream commitment; honor idempotency/retry hints.
  - Add atomic quota reservation/reconciliation, bounded cancellation-aware admission, and circuit-breaker behavior using the existing health records. Completed: Redis TPM reservation/reconciliation keeps a request's reservation conservative when any post-acceptance path has unknown usage, bounded cancellation-aware queues, lease renewal, a 30-second closed/open/half-open circuit cooldown, and PostgreSQL transactions covering request logs, Key/user usage, and request statistics. A partial unique index on Key + request ID prevents duplicate billing; complete integration coverage remains pending.
  - Validate upstream URLs/HTTPS policy and extend request-detail redaction for media/tool data.
- **Validation**:
  - Mock upstream retry/timeout/429/SSE tests; contention and cancellation tests; circuit state tests; header/redaction checks. Completed: isolated proxy fixtures prove retry and fallback share one TPM reservation and settle actual successful usage, plus stream completion/cancellation TPM settlement and slot release; a PostgreSQL-mode fixture proves duplicate Key/request-ID writes do not repeat durable Key, user-quota, or request-stat accounting; proxy fixtures prove an open circuit excludes a route before channel-slot acquisition and an upstream failure records a circuit observation then releases its slots; focused circuit transition tests cover closed/open/half-open state changes; a Redis semaphore fixture proves acquired leases release exactly once. Redis lease behavior still lacks an end-to-end proxy fixture.

### Stage 5: Observability, conformance, and rollout

- **Files modified**: `lib/log-generator.ts`, log schema/API/UI as needed, conversion/proxy/upstream/route fixtures, `scripts/verify-multi-instance.mjs`, settings and documentation.
- **Specific logic**:
  - Log native/bridge mode, feature requirements/rejections, capability profile, per-attempt result, upstream request ID, retry/fallback reason, and timing without sensitive values. Completed: opt-in request details include direction, successful attempt chains, allowlisted upstream request IDs, selected capability profiles, and bridge conversion rejection facts; Dashboard aggregates only auditable records by direction, outcome/rejection, and timing while explicitly reporting non-audited records as unclassified. Complete contract coverage and staged controls remain pending.
  - Track compatibility errors separately from channel-health failures.
  - Add contract and property-style tests proving accepted bridge inputs preserve required semantics. Completed: focused conversion tests cover preservation of accepted Chat controls and refusal of representative unsupported Responses controls, while upstream contracts cover provider-native endpoint selection and `Retry-After`; isolated proxy fixtures prove native OpenAI Chat, Responses, and Claude controls are forwarded unchanged, successful OpenAI→Claude and Claude→OpenAI JSON responses return the caller's protocol shape, both bridge streaming directions return the caller's SSE framing, and unsupported bridge fields fail with a client error before either primary or fallback upstream dispatch; `bun run smoke:native` exercises configured native Messages, Chat, Responses, and Embeddings channels when explicit smoke credentials are supplied; setting `API_PROXY_SMOKE_BRIDGE=1` additionally checks configured Chat→Claude and Messages→OpenAI mappings, while `API_PROXY_SMOKE_STREAM=1` checks Messages and Chat SSE framing. Actual deployment-channel execution remains pending.
  - Provide a reversible bridge-capability audit mode that records only safe bridge facts without request/response payloads and never dispatches incompatible conversions. Strict conversion rejection remains mandatory; forwarding an incompatible request as "report-only" is prohibited.
- **Validation**:
  - Run focused Bun fixtures, `bunx tsc --noEmit`, `bun run build`, multi-instance verification, configured-channel smoke tests, and synthetic bridge matrix checks.

## Testing Strategy

- **Happy path**: Native Messages, Chat, Responses, and Embeddings against matching upstreams; supported bridge text/tool/image/reasoning requests in stream and non-stream modes.
- **Error path**: Unsupported bridge fields, malformed tools/SSE, timeout, 429, 5xx, client cancellation, quota contention, unavailable capability, and fallback eligibility failures.
- **Regression scope**: Existing model mappings, key/user limits, channel health monitoring, request logging/redaction, usage accounting, SSE log fanout, and configured fallback behavior.

## Risks & Mitigation

- **Provider drift**: versioned profiles and protocol fixtures make support explicit; unknown bridge capability is rejected.
- **Semantic mismatch**: native pass-through remains available; bridge support remains intentionally limited to documented equivalents.
- **Security/privacy**: remote media is not fetched; credentials are replaced; headers are allowlisted; request detail is redacted.
- **Reliability migration**: quota/circuit changes ship behind observable stages and remain reversible.
- **Scope control**: batches, files, audio, realtime, webhooks, and a generic provider plugin framework are deferred until there is concrete product demand and a tested contract.

## Rollback Plan

- Disable strict bridge enforcement by mapping/cohort while retaining native paths.
- Keep capability migrations additive with conservative defaults, so application rollback does not erase channel/model configuration.
- Use request IDs and bridge metrics to identify the affected provider/model cohort before re-enabling a stage.

# Backend Pagination Design Document

## Background & Goals
- Problem: list pages currently fetch full datasets and paginate in the browser, which does not scale for logs, audit data, users, keys, gift cards, channels, models, mappings, pricing, rankings, channel status, user detail tables, and model square.
- Success criteria: every heavy API-backed visible list pagination operates on server-selected rows; the browser only holds the current page plus filter metadata needed for controls.
- Current status: complete for primary heavy lists (users, keys, channels, logs, audit, models, mappings, pricing, gift cards). Derived dashboard/ranking arrays are intentionally bounded summaries and retain local pagination for responsive sorting/filtering.

## High-Level Design
- API-backed lists accept `page`, `pageSize`, `query`, and filter query params, returning `{ rows, total, page, pageSize }`.
- Server-rendered stats lists use URL search params and server-side slicing/querying, then render only current rows.
- Existing `ListPagination` remains the common UI surface.
- Search/filter state is still controlled by each client component, but changing it triggers a backend request instead of local array slicing.

## Implementation Plan

### Stage 1: API-backed list endpoints
- **Files modified**: `app/api/users/route.ts`, `app/api/keys/route.ts`, `app/api/channels/route.ts`, `app/api/models/route.ts`, `app/api/model-mappings/route.ts`, `app/api/model-prices/route.ts`, `app/api/gift-cards/route.ts`, `app/api/logs/route.ts`
- **Specific logic**: Parse pagination and filters from `NextRequest.nextUrl.searchParams`; apply database `where`, `orderBy`, `limit`, `offset`; return paginated shape when pagination params are present while preserving existing array responses for legacy callers.
- **Validation**: Use `bun run build`; manually call representative endpoints with `page=1&pageSize=20` and filters.

### Stage 2: Client table data loading
- **Files modified**: `components/users/users-table.tsx`, `components/keys/keys-table.tsx`, `components/channels/channels-table.tsx`, `components/models/models-table.tsx`, `components/mappings/mappings-table.tsx`, `components/pricing/pricing-table.tsx`, `components/gift-cards/admin-gift-cards.tsx`, `components/logs/log-stream.tsx`, `components/models/model-square-list.tsx`
- **Specific logic**: Replace local `filter(...).slice(...)` pagination with API requests keyed by page, search, and filters; preserve current create/update/delete reload flows.
- **Validation**: Verify page changes request new data and total counts update.

### Stage 3: Server-rendered derived lists
- **Files modified**: `app/audit/page.tsx`, `components/audit/audit-table.tsx`, `app/admin/channel-status/page.tsx`, `components/channels/channel-health-list.tsx`, `components/rankings/rankings-tabs.tsx`, `components/users/user-detail-tables.tsx`, related stats helpers if needed.
- **Specific logic**: Move filtering/pagination to server page/query helpers or endpoint equivalents; client pagination updates URL/query or requests current page.
- **Validation**: Confirm only current rows are rendered and pagination totals are correct.

## Testing Strategy
- Happy path tests: first page, next page, last page, search query, each filter, empty result.
- Error path tests: invalid page/pageSize clamps to safe defaults; unknown filters do not crash.
- Regression scope: create/edit/delete flows still refresh list totals; SSE log insertion does not break log pagination.

## Risks & Mitigation
- Risk: changing endpoints from array to object may break existing callers.
- Mitigation: only return paginated object when pagination params are present; otherwise keep the legacy array response until all callers are migrated.
- Risk: server pagination for derived dashboard/ranking data may require larger refactors.
- Mitigation: implement API-backed table lists first, then derived lists in isolated helpers.

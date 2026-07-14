# Dashboard Aggregation Optimization Design Document

## Background & Goals
- Problem: dashboard pages trim client props, but PostgreSQL stats paths still fetch many raw `request_stats` rows and aggregate in Node.
- Goal: move overview aggregation to PostgreSQL grouped queries while preserving existing visible numbers and pricing behavior.
- Success criteria: admin overview, personal overview, and admin user detail render unchanged; overview stats no longer fetch all period rows from `request_stats` for basic aggregates.

## High-Level Design
- Keep `request_stats` as the lightweight statistics fact table.
- Use Drizzle `sql` aggregate expressions in PostgreSQL paths.
- Keep cost calculation in TypeScript with existing price fallback logic, but feed it grouped token totals instead of raw request rows.
- Keep bridge observability detail parsing as a narrow `request_logs` query because it depends on JSON request details.

## Implementation Plan

### Stage 1: Planning docs
- **Files modified**: `docs/IMPLEMENTATION_PLAN.md`, `docs/plan/dashboard-aggregation-optimization.md`
- **Specific logic**: Register this optimization and keep this design document current.
- **Validation**: Confirm docs link resolves.

### Stage 2: Admin/dashboard stats aggregation
- **Files modified**: `lib/stats.ts`
- **Specific logic**: Refactor `getDashboardStatsAsync` PostgreSQL path to use summary, count, grouped bucket, channel, key, user, model, and top-user-series queries.
- **Validation**: `bunx tsc --noEmit`; compare admin dashboard visible totals and empty-state behavior.

### Stage 3: User detail aggregation
- **Files modified**: `lib/user-stats.ts`, `app/dashboard/page.tsx`
- **Specific logic**: Add `includeTables` option. Use aggregate queries for totals/key stats/model stats/token buckets, and skip recent table rows for personal overview.
- **Validation**: Personal dashboard still renders; admin user detail still shows keys/models/recent logs.

### Stage 4: Final checks
- **Files modified**: none expected
- **Specific logic**: Run typecheck/build and inspect diff for raw full-row stats fetches in overview paths.
- **Validation**: `bunx tsc --noEmit`; `bun run build` if typecheck passes.

## Testing Strategy
- Happy path: visit `/admin/dashboard`, `/dashboard`, and `/users/[id]` with non-empty stats.
- Error/empty path: use a time range with no rows and confirm empty states/zero values render.
- Regression scope: totals, success rate, token totals, cache totals, costs, top key/user/model ordering, trend charts.

## Risks & Mitigation
- Percentile SQL may differ from JS if using continuous percentile. Use `percentile_disc` to match the existing discrete percentile helper.
- Pricing fallback is non-trivial. Keep pricing in TypeScript and only reduce rows via grouped cost-basis queries.
- Bridge observability remains raw. This is deliberate until protocol direction is denormalized.
- Rollback: revert `lib/stats.ts`, `lib/user-stats.ts`, and the personal dashboard call-site change.
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`api-proxy` is a self-hosted Next.js App Router application that acts as a Claude/OpenAI-compatible API gateway. It includes a web console for users and admins, PostgreSQL persistence via Drizzle ORM, and Redis-backed rate limiting, concurrency control, channel health locks, and realtime log fanout.

The README is in Chinese and is the source of truth for product behavior, setup, deployment, and operations details.

## Common Commands

This project uses Bun for package management.

```bash
bun install
bun run dev                 # Next.js dev server on http://localhost:3000
bun run build               # Production build
bun run start               # Production server on port 3000
bunx tsc --noEmit           # Type-check when a fast validation is needed
```

Local infrastructure and database:

```bash
cp .env.example .env
bun run compose:dev:infra   # Start PostgreSQL and Redis only
bun run db:pg:push          # Push Drizzle schema directly to PostgreSQL
bun run db:studio           # Open Drizzle Studio
bun run db:pg:generate      # Generate PostgreSQL migrations
bun run db:pg:migrate       # Run PostgreSQL migrations
bun run db:pg:init          # Runtime schema initializer
```

Docker Compose development helpers:

```bash
bun run compose:dev:up      # Start dev compose services
bun run compose:dev:app     # Start app container via dev compose profile
bun run compose:dev:logs    # Tail app container logs
bun run compose:dev:down    # Stop dev compose services
bun run compose:dev:pg:push # Push schema from inside app container
```

There is currently no configured `test`, `lint`, or single-test command in `package.json`; do not invent one. Use `bunx tsc --noEmit` and/or `bun run build` for validation unless adding a test runner as part of the task.

## Required Local Environment

Minimum local `.env` keys from `.env.example`:

```bash
APP_SECRET=change-this-to-a-long-random-secret
EMAIL_VERIFY_SECRET=change-this-to-a-long-random-email-secret
POSTGRES_PASSWORD=change-this-postgres-password
```

For a production-like local setup, `docker-compose.dev.yml` supplies defaults for `DATABASE_URL`, `REDIS_URL`, `PORT`, `HOSTNAME`, and related development environment values.

## High-Level Architecture

### App Router layout

- `app/` contains pages and route handlers.
- `app/v1/messages`, `app/v1/chat/completions`, and `app/v1/responses` are provider-compatible proxy entrypoints.
- `app/api/*` contains console/admin APIs for auth, users, keys, channels, models, mappings, pricing, stats, logs, settings, config import/export, gift cards, health, and worker actions.
- `middleware.ts` protects non-public pages by checking the `userId` cookie or `x-user-id` header; `/api/*` and `/v1/*` routes pass through and handle their own auth.

### UI structure

- `components/*` mirrors major product areas: dashboard charts, channels, keys, logs, models, mappings, pricing, rankings, settings, users, gift cards, and auth.
- `components/app-shell.tsx` controls whether the topbar is shown; public/auth pages use different shell styling.
- Most interactive tables are client components that fetch JSON from `app/api/*` routes and use shared controls in `components/ui/*`.

### Database layer

- `lib/db/pg-schema.ts` defines all PostgreSQL tables: users, keys, channels, request logs, activities, channel test logs, model mappings, model catalog, settings, model prices, user quotas, email verifications, and gift cards.
- `lib/db/pg.ts` creates the PostgreSQL Drizzle client.
- `lib/db/index.ts` exports `db` and `schema` compatibility aliases over PostgreSQL. Some older code still uses `.all()`/`.get()` style helpers through this compatibility type, while newer paths import `pgDb`/`pgSchema` directly.
- `drizzle.pg.config.ts` is the Drizzle config used by the `db:pg:*` scripts.

### Proxy request flow

The core gateway logic is in `lib/proxy.ts`:

1. Resolve and validate the relay API key from `Authorization: Bearer sk-relay-...`.
2. Enforce key status, key quota, key RPM/TPM, user balance, user RPM/TPM, and max concurrency.
3. Check model catalog visibility/enabled state and model mappings.
4. Select candidate channels by provider, model support, channel health, mapping scope, and weight.
5. Call upstream providers through `lib/upstream.ts`.
6. Retry/fallback on upstream 429, 5xx, and network errors when another eligible channel exists.
7. Log request metadata, token usage, latency, errors, and optional request/response detail through `lib/log-generator.ts`.
8. Update user quota/cost accounting via user quota helpers.

`lib/upstream.ts` is deliberately small: it constructs Claude/OpenAI endpoints, provider-specific auth headers, timeout/abort behavior, and returns a stream or normalized upstream error.

### Protocol conversion

`lib/protocol-conversion.ts` contains conversion helpers between OpenAI-compatible and Claude-compatible request/response shapes. Touch this when changing `/v1/chat/completions`, `/v1/responses`, or cross-provider routing behavior.

### Settings and admin-managed behavior

- `lib/settings.ts` stores site, SMTP, announcement, maintenance, logging, and billing-related configuration in the `settings` table.
- Admin settings are surfaced through `components/settings/settings-form.tsx` and `app/api/settings` routes.
- Announcement HTML is sanitized before rendering; behavior is documented in README under Admin Guide.

### Realtime logs and operational data

- Request logs and details are persisted in PostgreSQL.
- Redis is used for distributed counters/semaphores and realtime fanout when configured.
- `lib/log-generator.ts` provides the global log hub and SSE broadcast behavior used by log routes/components.
- Dashboard, rankings, user detail, and model usage pages aggregate data from `lib/stats.ts`, `lib/runtime-stats.ts`, and `lib/user-stats.ts`.

### Auth model

- Browser login state is based on a `userId` cookie; `x-user-id` is also accepted for current-user lookup.
- `lib/auth.ts` exposes `getCurrentUser`, `requireUser`, `requireAdmin`, and `isAdmin`.
- The first registered user becomes `super_admin`; later users are normal users unless changed by an admin.

## Validation Notes

- Use `/api/health` to confirm a running deployment.
- After schema changes, run `bun run db:pg:push` against local PostgreSQL or generate/migrate depending on the intended workflow.
- After proxy-flow changes, validate both Claude-compatible `/v1/messages` and OpenAI-compatible `/v1/chat/completions` or `/v1/responses` as relevant.
- If changing quota/rate-limit/concurrency behavior, exercise negative paths that should return `402` or `429`.

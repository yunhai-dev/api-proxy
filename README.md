# api-proxy

Claude / OpenAI API 中转站，内置用户、密钥、渠道、模型、定价、日志、额度、礼品卡和公告管理。项目基于 Next.js App Router 构建，使用 PostgreSQL 持久化业务数据，Redis 承担限流、并发控制和实时日志广播，适合自托管为团队统一的 AI API Gateway。

## Features

- **Claude / OpenAI 兼容代理**：支持 Anthropic Messages API、OpenAI Chat Completions、Embeddings 和 Responses API 风格入口。
- **多渠道路由与故障转移**：按模型、渠道状态、权重和可用性选择上游，支持 429、5xx、网络错误自动 fallback。
- **用户与 API Key 管理**：支持用户角色、状态、Key 生成/停用/删除、Key 级限额、RPM/TPM 和最大并发。
- **账户余额与续费**：用户额度耗尽后返回 `402`，管理员可调整额度，用户可通过礼品卡充值。
- **礼品卡系统**：管理员生成一次性礼品卡，用户在控制台弹窗内核销。
- **模型广场**：公开展示可用模型、调用方式、上游映射和模型价格。
- **模型管理与定价**：后台维护模型可见性、启用状态、展示名称、上游模型和每百万 Token 价格。
- **公告管理**：管理员可配置 HTML 公告，支持顶部滚动公告和弹窗公告两种形式。
- **管理总览**：查看请求量、成功率、延迟、Token、费用、缓存命中、渠道流量和用户 Token 趋势。
- **实时日志**：请求日志支持筛选、详情记录和 SSE 实时推送。
- **站点与邮件配置**：支持站点名称、Logo、SMTP 邮件验证、维护模式等配置。
- **容器化部署**：提供 Dockerfile、Docker Compose 和 Kubernetes 示例清单。

## Tech Stack

- [Next.js 15](https://nextjs.org/) App Router
- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Bun](https://bun.sh/) for package management
- [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL
- Redis for rate limits, semaphores, health locks and log fanout
- Recharts for dashboard charts
- Docker / Docker Compose / Kubernetes

## Architecture

```text
Client / SDK
    |
    |  Authorization: Bearer sk-relay-...
    v
Next.js API Routes
    |
    |-- Auth and API key validation
    |-- User quota, RPM, TPM and concurrency checks
    |-- Model mapping and channel selection
    |-- Weighted routing and retry fallback
    v
Upstream Providers
    |-- Claude-compatible channels
    |-- OpenAI-compatible channels

PostgreSQL: users, keys, channels, models, prices, quotas, logs, settings
Redis: RPM/TPM counters, semaphores, channel locks, SSE fanout
```

## Quick Start

### Prerequisites

- Node.js 22+
- Bun 1.3+
- Docker and Docker Compose
- PostgreSQL 16+
- Redis 7+

### Start PostgreSQL and Redis

```bash
cp .env.example .env
bun install
bun run compose:dev:infra
```

### Push database schema

```bash
bun run db:pg:push
```

### Start the app

```bash
bun run dev
```

Open `http://localhost:3000`.

The first registered user becomes `super_admin`; later users default to normal users unless changed by an admin.

## Environment Variables

`.env.example` contains the minimum local variables:

```bash
APP_SECRET=change-this-to-a-long-random-secret
EMAIL_VERIFY_SECRET=change-this-to-a-long-random-email-secret
POSTGRES_PASSWORD=change-this-postgres-password
```

Production commonly also needs:

```bash
DATABASE_URL=postgres://api_proxy:<password>@postgres:5432/api_proxy
DATABASE_POOL_SIZE=20
REDIS_URL=redis://redis:6379
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
```

Important notes:

- `APP_SECRET` is required in production for encrypted sensitive settings.
- `DATABASE_URL` must point to PostgreSQL.
- `REDIS_URL` enables distributed rate limiting, concurrency controls and log fanout.
- SMTP settings are configured from the admin UI and stored in the database.

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start Next.js dev server on port `3000` |
| `bun run build` | Build production app |
| `bun run start` | Start production server on port `3000` |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run db:pg:generate` | Generate PostgreSQL migrations |
| `bun run db:pg:migrate` | Run PostgreSQL migrations |
| `bun run db:pg:push` | Push schema directly to PostgreSQL |
| `bun run db:pg:init` | Initialize PostgreSQL schema at runtime |
| `bun run compose:dev:infra` | Start local PostgreSQL and Redis |
| `bun run compose:dev:app` | Start the app container via dev compose profile |
| `bun run compose:dev:logs` | Tail app logs |
| `bun run compose:dev:down` | Stop dev compose services |

## API Usage

Create or copy an active API key from the dashboard. Keys use the `sk-relay-...` format.

### Claude-compatible Messages API

```bash
KEY="sk-relay-XXXX-xxxxxxxxxxxxxxxx"

curl -X POST http://localhost:3000/v1/messages \
  -H "content-type: application/json" \
  -H "authorization: Bearer $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-haiku-4-5",
    "max_tokens": 128,
    "messages": [{ "role": "user", "content": "hello" }]
  }'
```

### Claude-compatible streaming

```bash
curl -N -X POST http://localhost:3000/v1/messages \
  -H "content-type: application/json" \
  -H "authorization: Bearer $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-haiku-4-5",
    "max_tokens": 128,
    "stream": true,
    "messages": [{ "role": "user", "content": "hi stream" }]
  }'
```

### OpenAI-compatible Chat Completions API

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer $KEY" \
  -d '{
    "model": "gpt-5-mini",
    "messages": [{ "role": "user", "content": "hello" }]
  }'
```

### OpenAI-compatible Embeddings API

```bash
curl -X POST http://localhost:3000/v1/embeddings \
  -H "content-type: application/json" \
  -H "authorization: Bearer $KEY" \
  -d '{
    "model": "text-embedding-3-small",
    "input": "hello"
  }'
```

For upstream channels, set `baseUrl` to the API root such as `https://api.openai.com`; the proxy adds `/v1` automatically. If the provider requires another version, include its terminal version path in the URL, such as `https://provider.example/v3`; the proxy then appends only the endpoint.

### Usage query

```bash
curl "http://localhost:3000/api/v1/usage/$KEY?range=24h"
```

Supported ranges depend on the usage route implementation. Common values include `24h`, `7d` and `30d`.

## Admin Guide

### Channels

Add upstream providers in **渠道**:

- `type`: `claude` or `openai`
- `baseUrl`: upstream API root URL; use a terminal version path such as `/v3` when required by the provider
- `apiKey`: upstream provider key
- `models`: accepted model list, or `*` for all models
- `weight`: weighted routing priority
- `maxConcurrency`: channel-level concurrency limit
- health check model and interval

### Models

Use **模型** to control which models are enabled and visible in the public model square. Models can point to an upstream model via mapping.

### Pricing

Use **定价** to configure model cost per million tokens:

- input tokens
- output tokens
- cache read tokens
- cache creation tokens

Model square cards and detail panels display these prices. Missing prices appear as `未定价`.

### Users and quotas

Admins can set user quota, RPM, TPM and max concurrency. User quota is dollar-based:

- `quotaUsd`: total available quota
- `usedUsd`: consumed amount
- remaining balance = `quotaUsd - usedUsd`

If a user has no quota record, zero quota, or has used all quota, proxy requests return `402` with a recharge message.

### Gift cards

Admins can generate one-time gift cards. Users redeem gift cards from the dashboard popup. The full gift card code is only shown once after generation; only a hash is stored.

### Announcements

Admins can configure announcements in **设置**:

- enabled / disabled
- `轮播滚动`
- `弹窗`
- title
- HTML content

Announcement HTML is sanitized before rendering. The sanitizer removes scripts, iframes, event attributes and `javascript:` links.

### Maintenance mode

When maintenance mode is enabled, model proxy requests are rejected with the configured maintenance message.

## Docker Deployment

The production Docker Compose file includes app, PostgreSQL and Redis.

```bash
cp .env.example .env
docker compose up -d
```

Check health:

```bash
curl http://localhost:3000/api/health
```

Persistent data:

- PostgreSQL: `api_proxy_postgres`
- Redis: `api_proxy_redis`

The app container is stateless. Back up PostgreSQL and Redis volumes for disaster recovery.

## Kubernetes Deployment

An example manifest is available at `k8s/api-proxy.yaml`. It includes:

- Namespace
- Secret and ConfigMap
- PostgreSQL workload and service
- Redis workload and service
- api-proxy Deployment and Service
- Ingress template

Apply after replacing secrets and image tag:

```bash
kubectl apply -f k8s/api-proxy.yaml
kubectl rollout status deployment/api-proxy -n api-proxy
kubectl get pods -n api-proxy -o wide
```

Update image:

```bash
kubectl set image deployment/api-proxy \
  api-proxy=registry.cn-shanghai.aliyuncs.com/ai_studio/api-proxy:v0.0.7 \
  -n api-proxy
```

Check logs:

```bash
kubectl logs deployment/api-proxy -n api-proxy --tail=100
```

## Project Structure

```text
app/
  api/                     API routes for admin, settings, stats, logs and auth
  v1/messages/             Claude-compatible proxy route
  v1/chat/completions/     OpenAI-compatible proxy route
  v1/responses/            OpenAI-compatible responses route
  page.tsx                 Landing page
  dashboard/               User dashboard
  admin/dashboard/         Admin dashboard

components/
  announcement.tsx         Announcement banner and modal
  dashboard/               Dashboard charts and controls
  gift-cards/              Gift card admin and redeem UI
  models/                  Model table and model square
  settings/                Admin settings form

lib/
  db/                      PostgreSQL schema and connection
  proxy.ts                 Auth, quota checks, routing and upstream proxy flow
  upstream.ts              Upstream HTTP client
  rate-limit.ts            RPM/TPM counters
  log-generator.ts         Request logging and SSE fanout
  model-catalog.ts         Model catalog and public model list
  settings.ts              App settings storage

scripts/
  init-postgres-schema.mjs Runtime schema initializer

k8s/
  api-proxy.yaml           Kubernetes example manifest
```

## Operations Checklist

- Set a strong `APP_SECRET` before production.
- Replace placeholder Kubernetes secrets before applying manifests.
- Configure Redis for production persistence and memory policy.
- Back up PostgreSQL regularly.
- Verify `/api/health` after deployment.
- Configure at least one upstream channel before issuing API keys.
- Configure model visibility and prices before publishing the model square.

## Troubleshooting

### `exec format error` in Kubernetes

The container image architecture does not match the node architecture. Use an image built for the target node architecture, for example AMD64 nodes require a Linux AMD64 image.

### Requests return `402`

The user's quota is missing, zero, or exhausted. Recharge with a gift card or update the user's quota from the admin UI.

### Requests return `429`

The API key or user hit RPM/TPM limits, or the API key's own daily quota was exceeded.

### No live channel

Check that at least one channel is enabled, healthy, and accepts the requested model. Also check model mappings and channel model lists.

### Model square shows `未定价`

Add pricing for that model in the admin **定价** page. Prices are matched by `provider + model`.

## Security Notes

- Full API keys and gift card codes should only be shown once to users.
- SMTP passwords are encrypted when `APP_SECRET` is configured.
- Announcement HTML is sanitized, but only admins should be allowed to edit it.
- Keep upstream provider keys out of exported public configs.
- Rotate compromised relay keys and upstream keys immediately.

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](./LICENSE) for details.

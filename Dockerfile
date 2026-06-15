FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN npm install -g bun@1.3.14
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgres://api_proxy:build-only@localhost:5432/api_proxy
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node ./node_modules/next/dist/bin/next build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Asia/Shanghai
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder --chown=1001:1001 /app/.next/standalone ./
COPY --from=builder --chown=1001:1001 /app/.next/static ./.next/static
COPY --from=deps --chown=1001:1001 /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=1001:1001 /app/scripts/init-postgres-schema.mjs ./scripts/init-postgres-schema.mjs

USER 1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["sh", "-c", "node scripts/init-postgres-schema.mjs && node server.js"]

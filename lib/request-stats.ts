import { sql } from "drizzle-orm";
import type { pgDb } from "./db/pg";

type PgWriter = Pick<typeof pgDb, "insert">;

type RequestStatInput = {
  requestId: string;
  ts: number;
  keyId: string;
  userId: string;
  channelId: string;
  channelType: "claude" | "openai";
  model: string;
  status: number;
  latencyMs: number;
  ttftMs: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  cacheTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export async function upsertRequestStatAsync(rawLogId: number, input: RequestStatInput, writer?: PgWriter) {
  const { pgDb, pgSchema } = await import("@/lib/db/pg");
  await (writer ?? pgDb).insert(pgSchema.requestStats).values({ rawLogId, ...input }).onConflictDoUpdate({
    target: pgSchema.requestStats.rawLogId,
    set: { ...input, userId: sql`coalesce(nullif(${pgSchema.requestStats.userId}, ''), ${input.userId})` },
  });
}

export async function backfillRequestStatsAsync(before?: number) {
  const { pgClient } = await import("@/lib/db/pg");
  const filter = before ? pgClient`WHERE rl.ts < ${before}` : pgClient``;
  await pgClient`
    INSERT INTO request_stats (raw_log_id, request_id, ts, key_id, user_id, channel_id, channel_type, model, status, latency_ms, ttft_ms, duration_ms, tokens_in, tokens_out, cache_tokens, cache_read_tokens, cache_creation_tokens)
    SELECT rl.id, rl.request_id, rl.ts, rl.key_id, coalesce(k.user_id, ''), rl.channel_id, coalesce(c.type, 'openai'), rl.model, rl.status, rl.latency_ms, rl.ttft_ms, rl.duration_ms, rl.tokens_in, rl.tokens_out, rl.cache_tokens, rl.cache_read_tokens, rl.cache_creation_tokens
    FROM request_logs rl
    LEFT JOIN keys k ON k.id = rl.key_id
    LEFT JOIN channels c ON c.id = rl.channel_id
    ${filter}
    ON CONFLICT (raw_log_id) DO UPDATE SET
      request_id = excluded.request_id,
      ts = excluded.ts,
      key_id = excluded.key_id,
      user_id = coalesce(nullif(request_stats.user_id, ''), excluded.user_id),
      channel_id = excluded.channel_id,
      channel_type = excluded.channel_type,
      model = excluded.model,
      status = excluded.status,
      latency_ms = excluded.latency_ms,
      ttft_ms = excluded.ttft_ms,
      duration_ms = excluded.duration_ms,
      tokens_in = excluded.tokens_in,
      tokens_out = excluded.tokens_out,
      cache_tokens = excluded.cache_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_creation_tokens = excluded.cache_creation_tokens
  `;
  const totalRows = before
    ? await pgClient`SELECT count(*)::int AS count FROM request_logs WHERE ts < ${before}`
    : await pgClient`SELECT count(*)::int AS count FROM request_logs`;
  const statRows = before
    ? await pgClient`SELECT count(*)::int AS count FROM request_stats WHERE ts < ${before}`
    : await pgClient`SELECT count(*)::int AS count FROM request_stats`;
  return { total: Number(totalRows[0]?.count ?? 0), synced: Number(statRows[0]?.count ?? 0) };
}

export async function backfillRequestStatsBeforeDeleteAsync(before: number) {
  await backfillRequestStatsAsync(before);
}

export async function backfillRequestStatsForKeyAsync(keyId: string, userId: string) {
  const { pgClient } = await import("@/lib/db/pg");
  await pgClient`
    INSERT INTO request_stats (raw_log_id, request_id, ts, key_id, user_id, channel_id, channel_type, model, status, latency_ms, ttft_ms, duration_ms, tokens_in, tokens_out, cache_tokens, cache_read_tokens, cache_creation_tokens)
    SELECT rl.id, rl.request_id, rl.ts, rl.key_id, ${userId}, rl.channel_id, coalesce(c.type, 'openai'), rl.model, rl.status, rl.latency_ms, rl.ttft_ms, rl.duration_ms, rl.tokens_in, rl.tokens_out, rl.cache_tokens, rl.cache_read_tokens, rl.cache_creation_tokens
    FROM request_logs rl
    LEFT JOIN channels c ON c.id = rl.channel_id
    WHERE rl.key_id = ${keyId}
    ON CONFLICT (raw_log_id) DO UPDATE SET
      request_id = excluded.request_id,
      ts = excluded.ts,
      key_id = excluded.key_id,
      user_id = excluded.user_id,
      channel_id = excluded.channel_id,
      channel_type = excluded.channel_type,
      model = excluded.model,
      status = excluded.status,
      latency_ms = excluded.latency_ms,
      ttft_ms = excluded.ttft_ms,
      duration_ms = excluded.duration_ms,
      tokens_in = excluded.tokens_in,
      tokens_out = excluded.tokens_out,
      cache_tokens = excluded.cache_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_creation_tokens = excluded.cache_creation_tokens
  `;
}

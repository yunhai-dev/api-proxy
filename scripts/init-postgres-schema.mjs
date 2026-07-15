import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadDotEnv();

const url = process.env.DATABASE_URL ?? "postgres://api_proxy:api_proxy_dev_password@localhost:5432/api_proxy";

const requiredTables = [
  "users",
  "user_quotas",
  "keys",
  "channels",
  "request_logs",
  "request_stats",
  "activities",
  "channel_test_logs",
  "model_mappings",
  "model_catalog",
  "settings",
  "model_prices",
  "email_verifications",
  "gift_cards",
];

const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    username text NOT NULL UNIQUE,
    display_name text NOT NULL,
    email text NOT NULL DEFAULT '',
    password_hash text NOT NULL DEFAULT '',
    role text NOT NULL DEFAULT 'user',
    status text NOT NULL DEFAULT 'active',
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_quotas (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    daily_quota_tokens integer NOT NULL DEFAULT 0,
    monthly_quota_tokens integer NOT NULL DEFAULT 0,
    daily_used_tokens integer NOT NULL DEFAULT 0,
    monthly_used_tokens integer NOT NULL DEFAULT 0,
    daily_quota_usd real NOT NULL DEFAULT 0,
    monthly_quota_usd real NOT NULL DEFAULT 0,
    daily_used_usd real NOT NULL DEFAULT 0,
    monthly_used_usd real NOT NULL DEFAULT 0,
    quota_usd real NOT NULL DEFAULT 0,
    used_usd real NOT NULL DEFAULT 0,
    rate_limit_rpm integer NOT NULL DEFAULT 0,
    rate_limit_tpm integer NOT NULL DEFAULT 0,
    max_concurrency integer NOT NULL DEFAULT 0,
    reset_daily_at bigint NOT NULL DEFAULT 0,
    reset_monthly_at bigint NOT NULL DEFAULT 0,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS keys (
    id text PRIMARY KEY,
    name text NOT NULL UNIQUE,
    user_id text NOT NULL DEFAULT '',
    prefix text NOT NULL,
    full_key text NOT NULL,
    channel_id text,
    channel_scope text NOT NULL DEFAULT 'all',
    status text NOT NULL DEFAULT 'active',
    quota integer NOT NULL DEFAULT 0,
    rate_limit_rpm integer NOT NULL DEFAULT 0,
    rate_limit_tpm integer NOT NULL DEFAULT 0,
    max_concurrency integer NOT NULL DEFAULT 0,
    used real NOT NULL DEFAULT 0,
    created_at bigint NOT NULL,
    last_used_at bigint
  )`,
  `ALTER TABLE keys ADD COLUMN IF NOT EXISTS channel_id text`,
  `CREATE TABLE IF NOT EXISTS channels (
    id text PRIMARY KEY,
    name text NOT NULL UNIQUE,
    type text NOT NULL,
    base_url text NOT NULL,
    api_key text NOT NULL,
    weight integer NOT NULL DEFAULT 1,
    max_concurrency integer NOT NULL DEFAULT 0,
    monitor_interval_sec integer NOT NULL DEFAULT 0,
    test_model text NOT NULL DEFAULT '',
    models text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'ok',
    circuit_state text NOT NULL DEFAULT 'closed',
    circuit_opened_at bigint NOT NULL DEFAULT 0,
    p50_ms integer NOT NULL DEFAULT 0,
    err_rate real NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT true,
    capabilities text[] NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS request_logs (
    id serial PRIMARY KEY,
    request_id text NOT NULL DEFAULT '',
    ts bigint NOT NULL,
    key_id text NOT NULL,
    channel_id text NOT NULL,
    model text NOT NULL,
    inbound_model text NOT NULL DEFAULT '',
    upstream_model text NOT NULL DEFAULT '',
    mapping_id text NOT NULL DEFAULT '',
    mapped_channel_ids text[] NOT NULL DEFAULT '{}',
    status integer NOT NULL,
    latency_ms integer NOT NULL,
    ttft_ms integer NOT NULL DEFAULT 0,
    duration_ms integer NOT NULL DEFAULT 0,
    tokens_in integer NOT NULL DEFAULT 0,
    tokens_out integer NOT NULL DEFAULT 0,
    cache_tokens integer NOT NULL DEFAULT 0,
    cache_read_tokens integer NOT NULL DEFAULT 0,
    cache_creation_tokens integer NOT NULL DEFAULT 0,
    request_detail text,
    error_msg text
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS request_logs_key_request_id_idx ON request_logs (key_id, request_id) WHERE key_id <> '' AND request_id <> ''`,
  `CREATE TABLE IF NOT EXISTS request_stats (
    raw_log_id integer PRIMARY KEY,
    request_id text NOT NULL DEFAULT '',
    ts bigint NOT NULL,
    key_id text NOT NULL,
    user_id text NOT NULL DEFAULT '',
    channel_id text NOT NULL,
    channel_type text NOT NULL,
    model text NOT NULL,
    status integer NOT NULL,
    latency_ms integer NOT NULL,
    ttft_ms integer NOT NULL DEFAULT 0,
    duration_ms integer NOT NULL DEFAULT 0,
    tokens_in integer NOT NULL DEFAULT 0,
    tokens_out integer NOT NULL DEFAULT 0,
    cache_tokens integer NOT NULL DEFAULT 0,
    cache_read_tokens integer NOT NULL DEFAULT 0,
    cache_creation_tokens integer NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS request_stats_ts_idx ON request_stats (ts)`,
  `CREATE INDEX IF NOT EXISTS request_stats_key_ts_idx ON request_stats (key_id, ts)`,
  `CREATE INDEX IF NOT EXISTS request_stats_user_ts_idx ON request_stats (user_id, ts)`,
  `INSERT INTO request_stats (raw_log_id, request_id, ts, key_id, user_id, channel_id, channel_type, model, status, latency_ms, ttft_ms, duration_ms, tokens_in, tokens_out, cache_tokens, cache_read_tokens, cache_creation_tokens)
    SELECT rl.id, rl.request_id, rl.ts, rl.key_id, coalesce(k.user_id, ''), rl.channel_id, coalesce(c.type, 'openai'), rl.model, rl.status, rl.latency_ms, rl.ttft_ms, rl.duration_ms, rl.tokens_in, rl.tokens_out, rl.cache_tokens, rl.cache_read_tokens, rl.cache_creation_tokens
    FROM request_logs rl
    LEFT JOIN keys k ON k.id = rl.key_id
    LEFT JOIN channels c ON c.id = rl.channel_id
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
      cache_creation_tokens = excluded.cache_creation_tokens`,
  `CREATE TABLE IF NOT EXISTS activities (
    id serial PRIMARY KEY,
    ts bigint NOT NULL,
    event text NOT NULL,
    actor text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS channel_test_logs (
    id serial PRIMARY KEY,
    channel_id text NOT NULL,
    ts bigint NOT NULL,
    ok boolean NOT NULL,
    latency_ms integer NOT NULL DEFAULT 0,
    error_msg text
  )`,
  `CREATE TABLE IF NOT EXISTS model_mappings (
    id text PRIMARY KEY,
    group_id text,
    provider text NOT NULL,
    target_provider text NOT NULL DEFAULT 'claude',
    inbound_model text NOT NULL,
    upstream_model text NOT NULL,
    channel_ids text[] NOT NULL DEFAULT '{}',
    enabled boolean NOT NULL DEFAULT true,
    created_at bigint NOT NULL
  )`,
  `ALTER TABLE model_mappings ADD COLUMN IF NOT EXISTS group_id text`,
  `ALTER TABLE model_mappings ADD COLUMN IF NOT EXISTS target_provider text NOT NULL DEFAULT 'claude'`,
  `ALTER TABLE model_mappings ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true`,
  `UPDATE model_mappings SET target_provider = provider WHERE target_provider = 'claude' AND provider <> 'claude'`,
  `CREATE INDEX IF NOT EXISTS model_mappings_group_id_idx ON model_mappings (group_id)`,
  `CREATE TABLE IF NOT EXISTS model_catalog (
    id text PRIMARY KEY,
    provider text NOT NULL,
    model text NOT NULL,
    display_name text NOT NULL DEFAULT '',
    upstream_model text NOT NULL DEFAULT '',
    visible boolean NOT NULL DEFAULT true,
    enabled boolean NOT NULL DEFAULT true,
    capabilities text[] NOT NULL DEFAULT '{}',
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS model_catalog_provider_model_unique ON model_catalog (provider, model)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS model_prices (
    id text PRIMARY KEY,
    provider text NOT NULL,
    channel_id text NOT NULL DEFAULT '',
    model text NOT NULL,
    input_price_per_mtok real NOT NULL DEFAULT 0,
    output_price_per_mtok real NOT NULL DEFAULT 0,
    cache_read_price_per_mtok real NOT NULL DEFAULT 0,
    cache_creation_price_per_mtok real NOT NULL DEFAULT 0,
    updated_at bigint NOT NULL
  )`,
  `ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS channel_id text NOT NULL DEFAULT ''`,
  `DROP INDEX IF EXISTS model_prices_provider_model_unique`,
  `CREATE UNIQUE INDEX IF NOT EXISTS model_prices_channel_model_unique ON model_prices (channel_id, model)`,
  `CREATE TABLE IF NOT EXISTS email_verifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    email text NOT NULL,
    code_hash text NOT NULL,
    token_hash text NOT NULL,
    purpose text NOT NULL DEFAULT 'register',
    expires_at bigint NOT NULL,
    used_at bigint,
    attempts integer NOT NULL DEFAULT 0,
    created_at bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS gift_cards (
    id text PRIMARY KEY,
    code_hash text NOT NULL UNIQUE,
    code_prefix text NOT NULL,
    code_suffix text NOT NULL,
    amount_usd real NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_by text NOT NULL,
    redeemed_by text,
    redeemed_at bigint,
    created_at bigint NOT NULL
  )`,
];

const sql = postgres(url, { max: 1, onnotice: () => {} });

async function waitForDatabase(retries = 30) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await sql`select 1`;
      return;
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function existingTables() {
  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(${requiredTables})
  `;
  return new Set(rows.map(row => row.table_name));
}

async function applyRequestStatsMigration(sql) {
  const start = statements.findIndex(statement => statement.includes("CREATE TABLE IF NOT EXISTS request_stats"));
  const end = statements.findIndex(statement => statement.includes("CREATE TABLE IF NOT EXISTS activities"));
  for (const statement of statements.slice(start, end)) {
    await sql.unsafe(statement);
  }
}

try {
  await waitForDatabase();
  await sql`select pg_advisory_lock(hashtext('api-proxy-schema-init'))`;
  try {
    const present = await existingTables();
    const missing = requiredTables.filter(table => !present.has(table));
    if (missing.length === 0) {
      console.log("[schema] PostgreSQL schema exists, applying safe migrations");
      await sql.unsafe(`ALTER TABLE keys ADD COLUMN IF NOT EXISTS channel_id text`);
      await sql.unsafe(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT '{}'`);
      await sql.unsafe(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS circuit_state text NOT NULL DEFAULT 'closed'`);
      await sql.unsafe(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS circuit_opened_at bigint NOT NULL DEFAULT 0`);
      await sql.unsafe(`ALTER TABLE model_catalog ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT '{}'`);
      await sql.unsafe(`ALTER TABLE model_mappings ADD COLUMN IF NOT EXISTS group_id text`);
      await sql.unsafe(`ALTER TABLE model_mappings ADD COLUMN IF NOT EXISTS target_provider text NOT NULL DEFAULT 'claude'`);
      await sql.unsafe(`ALTER TABLE model_mappings ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true`);
      await sql.unsafe(`UPDATE model_mappings SET target_provider = provider WHERE target_provider = 'claude' AND provider <> 'claude'`);
      await sql.unsafe(`DROP INDEX IF EXISTS model_mappings_provider_inbound_unique`);
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS model_mappings_group_id_idx ON model_mappings (group_id)`);
      await sql.unsafe(`ALTER TABLE model_prices ADD COLUMN IF NOT EXISTS channel_id text NOT NULL DEFAULT ''`);
      await sql.unsafe(`DROP INDEX IF EXISTS model_prices_provider_model_unique`);
      await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS model_prices_channel_model_unique ON model_prices (channel_id, model)`);
      await sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS request_logs_key_request_id_idx ON request_logs (key_id, request_id) WHERE key_id <> '' AND request_id <> ''`);
      await applyRequestStatsMigration(sql);
    } else {
      console.log(`[schema] initializing PostgreSQL schema, missing: ${missing.join(", ")}`);
      for (const statement of statements) {
        await sql.unsafe(statement);
      }
      console.log("[schema] PostgreSQL schema initialized");
    }
  } finally {
    await sql`select pg_advisory_unlock(hashtext('api-proxy-schema-init'))`;
  }
} finally {
  await sql.end();
}

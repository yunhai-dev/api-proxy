import { bigint, boolean, index, integer, pgTable, real, serial, text, uniqueIndex } from "drizzle-orm/pg-core";

export const keys = pgTable("keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  userId: text("user_id").notNull().default(""),
  prefix: text("prefix").notNull(),
  fullKey: text("full_key").notNull(),
  channelScope: text("channel_scope").notNull().default("all"),
  status: text("status").notNull().default("active"),
  quota: integer("quota").notNull().default(0),
  rateLimitRpm: integer("rate_limit_rpm").notNull().default(0),
  rateLimitTpm: integer("rate_limit_tpm").notNull().default(0),
  maxConcurrency: integer("max_concurrency").notNull().default(0),
  used: real("used").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  lastUsedAt: bigint("last_used_at", { mode: "number" }),
});

export const channels = pgTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type", { enum: ["claude", "openai"] }).notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull(),
  weight: integer("weight").notNull().default(1),
  maxConcurrency: integer("max_concurrency").notNull().default(0),
  monitorIntervalSec: integer("monitor_interval_sec").notNull().default(0),
  testModel: text("test_model").notNull().default(""),
  models: text("models").array().notNull().default([]),
  status: text("status").notNull().default("ok"),
  p50Ms: integer("p50_ms").notNull().default(0),
  errRate: real("err_rate").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
});

export const requestLogs = pgTable("request_logs", {
  id: serial("id").primaryKey(),
  requestId: text("request_id").notNull().default(""),
  ts: bigint("ts", { mode: "number" }).notNull(),
  keyId: text("key_id").notNull(),
  channelId: text("channel_id").notNull(),
  model: text("model").notNull(),
  inboundModel: text("inbound_model").notNull().default(""),
  upstreamModel: text("upstream_model").notNull().default(""),
  mappingId: text("mapping_id").notNull().default(""),
  mappedChannelIds: text("mapped_channel_ids").array().notNull().default([]),
  status: integer("status").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  ttftMs: integer("ttft_ms").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  cacheTokens: integer("cache_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
  requestDetail: text("request_detail"),
  errorMsg: text("error_msg"),
});

export const requestStats = pgTable("request_stats", {
  rawLogId: integer("raw_log_id").primaryKey(),
  requestId: text("request_id").notNull().default(""),
  ts: bigint("ts", { mode: "number" }).notNull(),
  keyId: text("key_id").notNull(),
  userId: text("user_id").notNull().default(""),
  channelId: text("channel_id").notNull(),
  channelType: text("channel_type", { enum: ["claude", "openai"] }).notNull(),
  model: text("model").notNull(),
  status: integer("status").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  ttftMs: integer("ttft_ms").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  cacheTokens: integer("cache_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
}, table => [
  index("request_stats_ts_idx").on(table.ts),
  index("request_stats_key_ts_idx").on(table.keyId, table.ts),
  index("request_stats_user_ts_idx").on(table.userId, table.ts),
]);

export const activities = pgTable("activities", {
  id: serial("id").primaryKey(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  event: text("event").notNull(),
  actor: text("actor").notNull(),
});

export const channelTestLogs = pgTable("channel_test_logs", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  ok: boolean("ok").notNull(),
  latencyMs: integer("latency_ms").notNull().default(0),
  errorMsg: text("error_msg"),
});

export const modelMappings = pgTable("model_mappings", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["claude", "openai"] }).notNull(),
  targetProvider: text("target_provider", { enum: ["claude", "openai"] }).notNull().default("claude"),
  inboundModel: text("inbound_model").notNull(),
  upstreamModel: text("upstream_model").notNull(),
  channelIds: text("channel_ids").array().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const modelCatalog = pgTable("model_catalog", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["claude", "openai"] }).notNull(),
  model: text("model").notNull(),
  displayName: text("display_name").notNull().default(""),
  upstreamModel: text("upstream_model").notNull().default(""),
  visible: boolean("visible").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, table => [uniqueIndex("model_catalog_provider_model_unique").on(table.provider, table.model)]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const modelPrices = pgTable("model_prices", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["claude", "openai"] }).notNull(),
  channelId: text("channel_id").notNull().default(""),
  model: text("model").notNull(),
  inputPricePerMTok: real("input_price_per_mtok").notNull().default(0),
  outputPricePerMTok: real("output_price_per_mtok").notNull().default(0),
  cacheReadPricePerMTok: real("cache_read_price_per_mtok").notNull().default(0),
  cacheCreationPricePerMTok: real("cache_creation_price_per_mtok").notNull().default(0),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, table => [uniqueIndex("model_prices_channel_model_unique").on(table.channelId, table.model)]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull().default(""),
  passwordHash: text("password_hash").notNull().default(""),
  role: text("role").notNull().default("user"),
  status: text("status").notNull().default("active"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const userQuotas = pgTable("user_quotas", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  dailyQuotaTokens: integer("daily_quota_tokens").notNull().default(0),
  monthlyQuotaTokens: integer("monthly_quota_tokens").notNull().default(0),
  dailyUsedTokens: integer("daily_used_tokens").notNull().default(0),
  monthlyUsedTokens: integer("monthly_used_tokens").notNull().default(0),
  dailyQuotaUsd: real("daily_quota_usd").notNull().default(0),
  monthlyQuotaUsd: real("monthly_quota_usd").notNull().default(0),
  dailyUsedUsd: real("daily_used_usd").notNull().default(0),
  monthlyUsedUsd: real("monthly_used_usd").notNull().default(0),
  quotaUsd: real("quota_usd").notNull().default(0),
  usedUsd: real("used_usd").notNull().default(0),
  rateLimitRpm: integer("rate_limit_rpm").notNull().default(0),
  rateLimitTpm: integer("rate_limit_tpm").notNull().default(0),
  maxConcurrency: integer("max_concurrency").notNull().default(0),
  resetDailyAt: bigint("reset_daily_at", { mode: "number" }).notNull().default(0),
  resetMonthlyAt: bigint("reset_monthly_at", { mode: "number" }).notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const emailVerifications = pgTable("email_verifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  tokenHash: text("token_hash").notNull(),
  purpose: text("purpose").notNull().default("register"),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  usedAt: bigint("used_at", { mode: "number" }),
  attempts: integer("attempts").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const giftCards = pgTable("gift_cards", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  codePrefix: text("code_prefix").notNull(),
  codeSuffix: text("code_suffix").notNull(),
  amountUsd: real("amount_usd").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: text("created_by").notNull(),
  redeemedBy: text("redeemed_by"),
  redeemedAt: bigint("redeemed_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export type Key = typeof keys.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type RequestLog = typeof requestLogs.$inferSelect;
export type RequestStat = typeof requestStats.$inferSelect;
export type GiftCard = typeof giftCards.$inferSelect;

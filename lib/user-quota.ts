import { nanoid } from "nanoid";
import { db, schema } from "@/lib/db";
import { getSettings, getSettingsAsync } from "@/lib/settings";
import { usePostgres } from "@/lib/db/runtime";

export function defaultUserQuota(userId: string, now = Date.now()) {
  const settings = getSettings();
  return {
    id: "uq_" + nanoid(8),
    userId,
    dailyQuotaTokens: 0,
    monthlyQuotaTokens: 0,
    dailyUsedTokens: 0,
    monthlyUsedTokens: 0,
    dailyQuotaUsd: 0,
    monthlyQuotaUsd: 0,
    dailyUsedUsd: 0,
    monthlyUsedUsd: 0,
    quotaUsd: 0,
    usedUsd: 0,
    rateLimitRpm: settings.defaultRateLimitRpm,
    rateLimitTpm: settings.defaultRateLimitTpm,
    maxConcurrency: settings.defaultMaxConcurrency,
    resetDailyAt: 0,
    resetMonthlyAt: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function effectiveUserLimits(quota: typeof schema.userQuotas.$inferSelect | undefined | null) {
  const settings = getSettings();
  return {
    rateLimitRpm: quota?.rateLimitRpm || settings.defaultRateLimitRpm,
    rateLimitTpm: quota?.rateLimitTpm || settings.defaultRateLimitTpm,
    maxConcurrency: quota?.maxConcurrency || settings.defaultMaxConcurrency,
  };
}

export async function effectiveUserLimitsAsync(
  quota: typeof schema.userQuotas.$inferSelect | undefined | null,
  preloadedSettings?: Awaited<ReturnType<typeof getSettingsAsync>>,
) {
  const settings = preloadedSettings ?? await getSettingsAsync();
  return {
    rateLimitRpm: quota?.rateLimitRpm || settings.defaultRateLimitRpm,
    rateLimitTpm: quota?.rateLimitTpm || settings.defaultRateLimitTpm,
    maxConcurrency: quota?.maxConcurrency || settings.defaultMaxConcurrency,
  };
}

export function insertDefaultUserQuota(userId: string, now = Date.now()) {
  const row = defaultUserQuota(userId, now);
  db.insert(schema.userQuotas).values(row).run();
  return row;
}

export async function defaultUserQuotaAsync(userId: string, now = Date.now()) {
  const settings = await getSettingsAsync();
  return {
    id: "uq_" + nanoid(8),
    userId,
    dailyQuotaTokens: 0,
    monthlyQuotaTokens: 0,
    dailyUsedTokens: 0,
    monthlyUsedTokens: 0,
    dailyQuotaUsd: 0,
    monthlyQuotaUsd: 0,
    dailyUsedUsd: 0,
    monthlyUsedUsd: 0,
    quotaUsd: 0,
    usedUsd: 0,
    rateLimitRpm: settings.defaultRateLimitRpm,
    rateLimitTpm: settings.defaultRateLimitTpm,
    maxConcurrency: settings.defaultMaxConcurrency,
    resetDailyAt: 0,
    resetMonthlyAt: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function insertDefaultUserQuotaAsync(userId: string, now = Date.now()) {
  if (!usePostgres()) return insertDefaultUserQuota(userId, now);
  const row = await defaultUserQuotaAsync(userId, now);
  const { pgDb, pgSchema } = await import("@/lib/db/pg");
  await pgDb.insert(pgSchema.userQuotas).values(row);
  return row;
}

import { db, schema } from "./db";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "./secret";
import { usePostgres } from "./db/runtime";

export type AppSettings = {
  debugModels: boolean;
  proxyMaxRetries: number;
  proxyRetry429: boolean;
  proxyRetry5xx: boolean;
  proxyRetryNetwork: boolean;
  proxyTreatEmptyOutputAsFailure: boolean;
  fallbackEnabled: boolean;
  fallbackChannelId: string;
  fallbackModel: string;
  recordAllRequestDetails: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  defaultRateLimitRpm: number;
  defaultRateLimitTpm: number;
  defaultMaxConcurrency: number;
  globalBillingMultiplier: number;
  siteUrl: string;
  siteName: string;
  siteLogoUrl: string;
  announcementEnabled: boolean;
  announcementMode: "marquee" | "modal";
  announcementTitle: string;
  announcementHtml: string;
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: "none" | "ssl" | "starttls";
  smtpUser: string;
  smtpPassword: string;
  smtpFromEmail: string;
  smtpFromName: string;
};

const defaults: AppSettings = {
  debugModels: false,
  proxyMaxRetries: 3,
  proxyRetry429: true,
  proxyRetry5xx: true,
  proxyRetryNetwork: true,
  proxyTreatEmptyOutputAsFailure: false,
  fallbackEnabled: false,
  fallbackChannelId: "",
  fallbackModel: "",
  recordAllRequestDetails: false,
  maintenanceMode: false,
  maintenanceMessage: "系统维护中，请稍后再试。",
  defaultRateLimitRpm: 0,
  defaultRateLimitTpm: 0,
  defaultMaxConcurrency: 0,
  globalBillingMultiplier: 1,
  siteUrl: "http://localhost:3000",
  siteName: "api-proxy",
  siteLogoUrl: "",
  announcementEnabled: false,
  announcementMode: "marquee",
  announcementTitle: "公告",
  announcementHtml: "",
  smtpEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: "starttls",
  smtpUser: "",
  smtpPassword: "",
  smtpFromEmail: "",
  smtpFromName: "api-proxy",
};

export function getSettings(): AppSettings {
  const rows = db.select().from(schema.settings).all();
  const values = new Map(rows.map(row => [row.key, row.value]));
  return {
    debugModels: bool(values.get("debugModels"), defaults.debugModels),
    proxyMaxRetries: Math.max(1, Number(values.get("proxyMaxRetries")) || defaults.proxyMaxRetries),
    proxyRetry429: bool(values.get("proxyRetry429"), defaults.proxyRetry429),
    proxyRetry5xx: bool(values.get("proxyRetry5xx"), defaults.proxyRetry5xx),
    proxyRetryNetwork: bool(values.get("proxyRetryNetwork"), defaults.proxyRetryNetwork),
    proxyTreatEmptyOutputAsFailure: bool(values.get("proxyTreatEmptyOutputAsFailure"), defaults.proxyTreatEmptyOutputAsFailure),
    fallbackEnabled: bool(values.get("fallbackEnabled"), defaults.fallbackEnabled),
    fallbackChannelId: values.get("fallbackChannelId") || defaults.fallbackChannelId,
    fallbackModel: values.get("fallbackModel") || defaults.fallbackModel,
    recordAllRequestDetails: bool(values.get("recordAllRequestDetails"), defaults.recordAllRequestDetails),
    maintenanceMode: bool(values.get("maintenanceMode"), defaults.maintenanceMode),
    maintenanceMessage: values.get("maintenanceMessage") || defaults.maintenanceMessage,
    defaultRateLimitRpm: Math.max(0, Number(values.get("defaultRateLimitRpm")) || defaults.defaultRateLimitRpm),
    defaultRateLimitTpm: Math.max(0, Number(values.get("defaultRateLimitTpm")) || defaults.defaultRateLimitTpm),
    defaultMaxConcurrency: Math.max(0, Number(values.get("defaultMaxConcurrency")) || defaults.defaultMaxConcurrency),
    globalBillingMultiplier: nonNegativeNumber(values.get("globalBillingMultiplier"), defaults.globalBillingMultiplier),
    siteUrl: values.get("siteUrl") || defaults.siteUrl,
    siteName: values.get("siteName") || defaults.siteName,
    siteLogoUrl: values.get("siteLogoUrl") || defaults.siteLogoUrl,
    announcementEnabled: bool(values.get("announcementEnabled"), defaults.announcementEnabled),
    announcementMode: announcementMode(values.get("announcementMode")),
    announcementTitle: values.get("announcementTitle") || defaults.announcementTitle,
    announcementHtml: values.get("announcementHtml") || defaults.announcementHtml,
    smtpEnabled: bool(values.get("smtpEnabled"), defaults.smtpEnabled),
    smtpHost: values.get("smtpHost") || defaults.smtpHost,
    smtpPort: Math.min(65535, Math.max(1, Number(values.get("smtpPort")) || defaults.smtpPort)),
    smtpSecure: secure(values.get("smtpSecure")),
    smtpUser: values.get("smtpUser") || defaults.smtpUser,
    smtpPassword: decryptSecret(values.get("smtpPassword") || defaults.smtpPassword),
    smtpFromEmail: values.get("smtpFromEmail") || defaults.smtpFromEmail,
    smtpFromName: values.get("smtpFromName") || defaults.smtpFromName,
  };
}

export async function getSettingsAsync(): Promise<AppSettings> {
  if (!usePostgres()) return getSettings();
  const { pgDb, pgSchema } = await import("./db/pg");
  const rows = await pgDb.select().from(pgSchema.settings);
  return settingsFromRows(rows.map(row => ({ key: row.key, value: row.value })));
}

export function updateSettings(input: Partial<AppSettings>) {
  const current = getSettings();
  const next: AppSettings = {
    debugModels: input.debugModels ?? current.debugModels,
    proxyMaxRetries: Math.max(1, Number(input.proxyMaxRetries) || current.proxyMaxRetries),
    proxyRetry429: input.proxyRetry429 ?? current.proxyRetry429,
    proxyRetry5xx: input.proxyRetry5xx ?? current.proxyRetry5xx,
    proxyRetryNetwork: input.proxyRetryNetwork ?? current.proxyRetryNetwork,
    proxyTreatEmptyOutputAsFailure: input.proxyTreatEmptyOutputAsFailure ?? current.proxyTreatEmptyOutputAsFailure,
    fallbackEnabled: input.fallbackEnabled ?? current.fallbackEnabled,
    fallbackChannelId: input.fallbackChannelId ?? current.fallbackChannelId,
    fallbackModel: input.fallbackModel ?? current.fallbackModel,
    recordAllRequestDetails: input.recordAllRequestDetails ?? current.recordAllRequestDetails,
    maintenanceMode: input.maintenanceMode ?? current.maintenanceMode,
    maintenanceMessage: input.maintenanceMessage ?? current.maintenanceMessage,
    defaultRateLimitRpm: Math.max(0, Number(input.defaultRateLimitRpm) || current.defaultRateLimitRpm),
    defaultRateLimitTpm: Math.max(0, Number(input.defaultRateLimitTpm) || current.defaultRateLimitTpm),
    defaultMaxConcurrency: Math.max(0, Number(input.defaultMaxConcurrency) || current.defaultMaxConcurrency),
    globalBillingMultiplier: input.globalBillingMultiplier === undefined ? current.globalBillingMultiplier : Math.max(0, Number(input.globalBillingMultiplier) || 0),
    siteUrl: input.siteUrl ?? current.siteUrl,
    siteName: input.siteName ?? current.siteName,
    siteLogoUrl: input.siteLogoUrl ?? current.siteLogoUrl,
    announcementEnabled: input.announcementEnabled ?? current.announcementEnabled,
    announcementMode: input.announcementMode ?? current.announcementMode,
    announcementTitle: input.announcementTitle ?? current.announcementTitle,
    announcementHtml: input.announcementHtml ?? current.announcementHtml,
    smtpEnabled: input.smtpEnabled ?? current.smtpEnabled,
    smtpHost: input.smtpHost ?? current.smtpHost,
    smtpPort: Math.min(65535, Math.max(1, Number(input.smtpPort) || current.smtpPort)),
    smtpSecure: input.smtpSecure ?? current.smtpSecure,
    smtpUser: input.smtpUser ?? current.smtpUser,
    smtpPassword: input.smtpPassword === undefined ? current.smtpPassword : input.smtpPassword,
    smtpFromEmail: input.smtpFromEmail ?? current.smtpFromEmail,
    smtpFromName: input.smtpFromName ?? current.smtpFromName,
  };
  const now = Date.now();
  for (const [key, value] of Object.entries(next)) {
    const raw = key === "smtpPassword" ? encryptSecret(String(value)) : String(value);
    const encoded = typeof value === "boolean" ? (value ? "1" : "0") : raw;
    const exists = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
    if (exists) {
      db.update(schema.settings).set({ value: encoded, updatedAt: now }).where(eq(schema.settings.key, key)).run();
    } else {
      db.insert(schema.settings).values({ key, value: encoded, updatedAt: now }).run();
    }
  }
  return next;
}

export async function updateSettingsAsync(input: Partial<AppSettings>) {
  if (!usePostgres()) return updateSettings(input);
  const { pgDb, pgSchema } = await import("./db/pg");
  const current = await getSettingsAsync();
  const next = nextSettings(current, input);
  const now = Date.now();
  for (const [key, value] of Object.entries(next)) {
    const raw = key === "smtpPassword" ? encryptSecret(String(value)) : String(value);
    const encoded = typeof value === "boolean" ? (value ? "1" : "0") : raw;
    await pgDb.insert(pgSchema.settings)
      .values({ key, value: encoded, updatedAt: now })
      .onConflictDoUpdate({ target: pgSchema.settings.key, set: { value: encoded, updatedAt: now } });
  }
  return next;
}

function settingsFromRows(rows: { key: string; value: string }[]): AppSettings {
  const values = new Map(rows.map(row => [row.key, row.value]));
  return {
    debugModels: bool(values.get("debugModels"), defaults.debugModels),
    proxyMaxRetries: Math.max(1, Number(values.get("proxyMaxRetries")) || defaults.proxyMaxRetries),
    proxyRetry429: bool(values.get("proxyRetry429"), defaults.proxyRetry429),
    proxyRetry5xx: bool(values.get("proxyRetry5xx"), defaults.proxyRetry5xx),
    proxyRetryNetwork: bool(values.get("proxyRetryNetwork"), defaults.proxyRetryNetwork),
    proxyTreatEmptyOutputAsFailure: bool(values.get("proxyTreatEmptyOutputAsFailure"), defaults.proxyTreatEmptyOutputAsFailure),
    fallbackEnabled: bool(values.get("fallbackEnabled"), defaults.fallbackEnabled),
    fallbackChannelId: values.get("fallbackChannelId") || defaults.fallbackChannelId,
    fallbackModel: values.get("fallbackModel") || defaults.fallbackModel,
    recordAllRequestDetails: bool(values.get("recordAllRequestDetails"), defaults.recordAllRequestDetails),
    maintenanceMode: bool(values.get("maintenanceMode"), defaults.maintenanceMode),
    maintenanceMessage: values.get("maintenanceMessage") || defaults.maintenanceMessage,
    defaultRateLimitRpm: Math.max(0, Number(values.get("defaultRateLimitRpm")) || defaults.defaultRateLimitRpm),
    defaultRateLimitTpm: Math.max(0, Number(values.get("defaultRateLimitTpm")) || defaults.defaultRateLimitTpm),
    defaultMaxConcurrency: Math.max(0, Number(values.get("defaultMaxConcurrency")) || defaults.defaultMaxConcurrency),
    globalBillingMultiplier: nonNegativeNumber(values.get("globalBillingMultiplier"), defaults.globalBillingMultiplier),
    siteUrl: values.get("siteUrl") || defaults.siteUrl,
    siteName: values.get("siteName") || defaults.siteName,
    siteLogoUrl: values.get("siteLogoUrl") || defaults.siteLogoUrl,
    announcementEnabled: bool(values.get("announcementEnabled"), defaults.announcementEnabled),
    announcementMode: announcementMode(values.get("announcementMode")),
    announcementTitle: values.get("announcementTitle") || defaults.announcementTitle,
    announcementHtml: values.get("announcementHtml") || defaults.announcementHtml,
    smtpEnabled: bool(values.get("smtpEnabled"), defaults.smtpEnabled),
    smtpHost: values.get("smtpHost") || defaults.smtpHost,
    smtpPort: Math.min(65535, Math.max(1, Number(values.get("smtpPort")) || defaults.smtpPort)),
    smtpSecure: secure(values.get("smtpSecure")),
    smtpUser: values.get("smtpUser") || defaults.smtpUser,
    smtpPassword: decryptSecret(values.get("smtpPassword") || defaults.smtpPassword),
    smtpFromEmail: values.get("smtpFromEmail") || defaults.smtpFromEmail,
    smtpFromName: values.get("smtpFromName") || defaults.smtpFromName,
  };
}

function nextSettings(current: AppSettings, input: Partial<AppSettings>): AppSettings {
  return {
    debugModels: input.debugModels ?? current.debugModels,
    proxyMaxRetries: Math.max(1, Number(input.proxyMaxRetries) || current.proxyMaxRetries),
    proxyRetry429: input.proxyRetry429 ?? current.proxyRetry429,
    proxyRetry5xx: input.proxyRetry5xx ?? current.proxyRetry5xx,
    proxyRetryNetwork: input.proxyRetryNetwork ?? current.proxyRetryNetwork,
    proxyTreatEmptyOutputAsFailure: input.proxyTreatEmptyOutputAsFailure ?? current.proxyTreatEmptyOutputAsFailure,
    fallbackEnabled: input.fallbackEnabled ?? current.fallbackEnabled,
    fallbackChannelId: input.fallbackChannelId ?? current.fallbackChannelId,
    fallbackModel: input.fallbackModel ?? current.fallbackModel,
    recordAllRequestDetails: input.recordAllRequestDetails ?? current.recordAllRequestDetails,
    maintenanceMode: input.maintenanceMode ?? current.maintenanceMode,
    maintenanceMessage: input.maintenanceMessage ?? current.maintenanceMessage,
    defaultRateLimitRpm: Math.max(0, Number(input.defaultRateLimitRpm) || current.defaultRateLimitRpm),
    defaultRateLimitTpm: Math.max(0, Number(input.defaultRateLimitTpm) || current.defaultRateLimitTpm),
    defaultMaxConcurrency: Math.max(0, Number(input.defaultMaxConcurrency) || current.defaultMaxConcurrency),
    globalBillingMultiplier: input.globalBillingMultiplier === undefined ? current.globalBillingMultiplier : Math.max(0, Number(input.globalBillingMultiplier) || 0),
    siteUrl: input.siteUrl ?? current.siteUrl,
    siteName: input.siteName ?? current.siteName,
    siteLogoUrl: input.siteLogoUrl ?? current.siteLogoUrl,
    announcementEnabled: input.announcementEnabled ?? current.announcementEnabled,
    announcementMode: input.announcementMode ?? current.announcementMode,
    announcementTitle: input.announcementTitle ?? current.announcementTitle,
    announcementHtml: input.announcementHtml ?? current.announcementHtml,
    smtpEnabled: input.smtpEnabled ?? current.smtpEnabled,
    smtpHost: input.smtpHost ?? current.smtpHost,
    smtpPort: Math.min(65535, Math.max(1, Number(input.smtpPort) || current.smtpPort)),
    smtpSecure: input.smtpSecure ?? current.smtpSecure,
    smtpUser: input.smtpUser ?? current.smtpUser,
    smtpPassword: input.smtpPassword === undefined ? current.smtpPassword : input.smtpPassword,
    smtpFromEmail: input.smtpFromEmail ?? current.smtpFromEmail,
    smtpFromName: input.smtpFromName ?? current.smtpFromName,
  };
}


function bool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value === "1" || value === "true";
}

function nonNegativeNumber(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function secure(value: string | undefined): AppSettings["smtpSecure"] {
  return value === "none" || value === "ssl" || value === "starttls" ? value : defaults.smtpSecure;
}

function announcementMode(value: string | undefined): AppSettings["announcementMode"] {
  return value === "modal" || value === "marquee" ? value : defaults.announcementMode;
}

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
  bridgeCapabilityAudit: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  defaultRateLimitRpm: number;
  defaultRateLimitTpm: number;
  defaultMaxConcurrency: number;
  globalBillingMultiplier: number;
  claudeBillingMultiplier: number;
  openaiBillingMultiplier: number;
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
  sub2apiBaseUrl: string;
  sub2apiAdminKey: string;
  notificationsAdminEnabled: boolean;
  serverChanUid: string;
  serverChanSendKey: string;
  platformIncidentCooldownMinutes: number;
  notifyAdminChannelCircuit: boolean;
  notifyAdminChannelCircuitRecovery: boolean;
  notifyAdminNoLiveChannel: boolean;
  notifyAdminNoLiveChannelRecovery: boolean;
  notifyAdminUpstreamExhausted: boolean;
  notifyAdminUpstreamExhaustedRecovery: boolean;
  notificationsUserEmailEnabled: boolean;
  notifyUserUsdBalance20: boolean;
  notifyUserUsdBalance10: boolean;
  notifyUserUsdBalance0: boolean;
  notifyUserKeyQuota80: boolean;
  notifyUserKeyQuota100: boolean;
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
  bridgeCapabilityAudit: false,
  maintenanceMode: false,
  maintenanceMessage: "系统维护中，请稍后再试。",
  defaultRateLimitRpm: 0,
  defaultRateLimitTpm: 0,
  defaultMaxConcurrency: 0,
  globalBillingMultiplier: 1,
  claudeBillingMultiplier: 1,
  openaiBillingMultiplier: 1,
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
  sub2apiBaseUrl: "",
  sub2apiAdminKey: "",
  notificationsAdminEnabled: false,
  serverChanUid: "",
  serverChanSendKey: "",
  platformIncidentCooldownMinutes: 10,
  notifyAdminChannelCircuit: false,
  notifyAdminChannelCircuitRecovery: false,
  notifyAdminNoLiveChannel: false,
  notifyAdminNoLiveChannelRecovery: false,
  notifyAdminUpstreamExhausted: false,
  notifyAdminUpstreamExhaustedRecovery: false,
  notificationsUserEmailEnabled: false,
  notifyUserUsdBalance20: false,
  notifyUserUsdBalance10: false,
  notifyUserUsdBalance0: false,
  notifyUserKeyQuota80: false,
  notifyUserKeyQuota100: false,
};

export function getSettings(): AppSettings {
  return settingsFromRows(db.select().from(schema.settings).all());
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
    bridgeCapabilityAudit: input.bridgeCapabilityAudit ?? current.bridgeCapabilityAudit,
    maintenanceMode: input.maintenanceMode ?? current.maintenanceMode,
    maintenanceMessage: input.maintenanceMessage ?? current.maintenanceMessage,
    defaultRateLimitRpm: Math.max(0, Number(input.defaultRateLimitRpm) || current.defaultRateLimitRpm),
    defaultRateLimitTpm: Math.max(0, Number(input.defaultRateLimitTpm) || current.defaultRateLimitTpm),
    defaultMaxConcurrency: Math.max(0, Number(input.defaultMaxConcurrency) || current.defaultMaxConcurrency),
    globalBillingMultiplier: input.globalBillingMultiplier === undefined ? current.globalBillingMultiplier : Math.max(0, Number(input.globalBillingMultiplier) || 0),
    claudeBillingMultiplier: input.claudeBillingMultiplier === undefined ? current.claudeBillingMultiplier : Math.max(0, Number(input.claudeBillingMultiplier) || 0),
    openaiBillingMultiplier: input.openaiBillingMultiplier === undefined ? current.openaiBillingMultiplier : Math.max(0, Number(input.openaiBillingMultiplier) || 0),
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
    sub2apiBaseUrl: input.sub2apiBaseUrl ?? current.sub2apiBaseUrl,
    sub2apiAdminKey: input.sub2apiAdminKey === undefined ? current.sub2apiAdminKey : input.sub2apiAdminKey,
    notificationsAdminEnabled: input.notificationsAdminEnabled ?? current.notificationsAdminEnabled,
    serverChanUid: input.serverChanUid ?? current.serverChanUid,
    serverChanSendKey: input.serverChanSendKey === undefined ? current.serverChanSendKey : input.serverChanSendKey,
    platformIncidentCooldownMinutes: input.platformIncidentCooldownMinutes ?? current.platformIncidentCooldownMinutes,
    notifyAdminChannelCircuit: input.notifyAdminChannelCircuit ?? current.notifyAdminChannelCircuit,
    notifyAdminChannelCircuitRecovery: input.notifyAdminChannelCircuitRecovery ?? current.notifyAdminChannelCircuitRecovery,
    notifyAdminNoLiveChannel: input.notifyAdminNoLiveChannel ?? current.notifyAdminNoLiveChannel,
    notifyAdminNoLiveChannelRecovery: input.notifyAdminNoLiveChannelRecovery ?? current.notifyAdminNoLiveChannelRecovery,
    notifyAdminUpstreamExhausted: input.notifyAdminUpstreamExhausted ?? current.notifyAdminUpstreamExhausted,
    notifyAdminUpstreamExhaustedRecovery: input.notifyAdminUpstreamExhaustedRecovery ?? current.notifyAdminUpstreamExhaustedRecovery,
    notificationsUserEmailEnabled: input.notificationsUserEmailEnabled ?? current.notificationsUserEmailEnabled,
    notifyUserUsdBalance20: input.notifyUserUsdBalance20 ?? current.notifyUserUsdBalance20,
    notifyUserUsdBalance10: input.notifyUserUsdBalance10 ?? current.notifyUserUsdBalance10,
    notifyUserUsdBalance0: input.notifyUserUsdBalance0 ?? current.notifyUserUsdBalance0,
    notifyUserKeyQuota80: input.notifyUserKeyQuota80 ?? current.notifyUserKeyQuota80,
    notifyUserKeyQuota100: input.notifyUserKeyQuota100 ?? current.notifyUserKeyQuota100,
  };
  const now = Date.now();
  for (const [key, value] of Object.entries(next)) {
    const raw = (key === "smtpPassword" || key === "sub2apiAdminKey" || key === "serverChanSendKey") ? encryptSecret(String(value)) : String(value);
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
    const raw = (key === "smtpPassword" || key === "sub2apiAdminKey" || key === "serverChanSendKey") ? encryptSecret(String(value)) : String(value);
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
    bridgeCapabilityAudit: bool(values.get("bridgeCapabilityAudit"), defaults.bridgeCapabilityAudit),
    maintenanceMode: bool(values.get("maintenanceMode"), defaults.maintenanceMode),
    maintenanceMessage: values.get("maintenanceMessage") || defaults.maintenanceMessage,
    defaultRateLimitRpm: Math.max(0, Number(values.get("defaultRateLimitRpm")) || defaults.defaultRateLimitRpm),
    defaultRateLimitTpm: Math.max(0, Number(values.get("defaultRateLimitTpm")) || defaults.defaultRateLimitTpm),
    defaultMaxConcurrency: Math.max(0, Number(values.get("defaultMaxConcurrency")) || defaults.defaultMaxConcurrency),
    globalBillingMultiplier: nonNegativeNumber(values.get("globalBillingMultiplier"), defaults.globalBillingMultiplier),
    claudeBillingMultiplier: nonNegativeNumber(values.get("claudeBillingMultiplier"), defaults.claudeBillingMultiplier),
    openaiBillingMultiplier: nonNegativeNumber(values.get("openaiBillingMultiplier"), defaults.openaiBillingMultiplier),
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
    sub2apiBaseUrl: values.get("sub2apiBaseUrl") || defaults.sub2apiBaseUrl,
    sub2apiAdminKey: decryptSecret(values.get("sub2apiAdminKey") || defaults.sub2apiAdminKey),
    notificationsAdminEnabled: bool(values.get("notificationsAdminEnabled"), defaults.notificationsAdminEnabled),
    serverChanUid: values.get("serverChanUid") || defaults.serverChanUid,
    serverChanSendKey: decryptSecret(values.get("serverChanSendKey") || defaults.serverChanSendKey),
    platformIncidentCooldownMinutes: boundedInteger(values.get("platformIncidentCooldownMinutes"), defaults.platformIncidentCooldownMinutes, 0, 1440),
    notifyAdminChannelCircuit: bool(values.get("notifyAdminChannelCircuit"), defaults.notifyAdminChannelCircuit),
    notifyAdminChannelCircuitRecovery: bool(values.get("notifyAdminChannelCircuitRecovery"), defaults.notifyAdminChannelCircuitRecovery),
    notifyAdminNoLiveChannel: bool(values.get("notifyAdminNoLiveChannel"), defaults.notifyAdminNoLiveChannel),
    notifyAdminNoLiveChannelRecovery: bool(values.get("notifyAdminNoLiveChannelRecovery"), defaults.notifyAdminNoLiveChannelRecovery),
    notifyAdminUpstreamExhausted: bool(values.get("notifyAdminUpstreamExhausted"), defaults.notifyAdminUpstreamExhausted),
    notifyAdminUpstreamExhaustedRecovery: bool(values.get("notifyAdminUpstreamExhaustedRecovery"), defaults.notifyAdminUpstreamExhaustedRecovery),
    notificationsUserEmailEnabled: bool(values.get("notificationsUserEmailEnabled"), defaults.notificationsUserEmailEnabled),
    notifyUserUsdBalance20: bool(values.get("notifyUserUsdBalance20"), defaults.notifyUserUsdBalance20),
    notifyUserUsdBalance10: bool(values.get("notifyUserUsdBalance10"), defaults.notifyUserUsdBalance10),
    notifyUserUsdBalance0: bool(values.get("notifyUserUsdBalance0"), defaults.notifyUserUsdBalance0),
    notifyUserKeyQuota80: bool(values.get("notifyUserKeyQuota80"), defaults.notifyUserKeyQuota80),
    notifyUserKeyQuota100: bool(values.get("notifyUserKeyQuota100"), defaults.notifyUserKeyQuota100),
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
    bridgeCapabilityAudit: input.bridgeCapabilityAudit ?? current.bridgeCapabilityAudit,
    maintenanceMode: input.maintenanceMode ?? current.maintenanceMode,
    maintenanceMessage: input.maintenanceMessage ?? current.maintenanceMessage,
    defaultRateLimitRpm: Math.max(0, Number(input.defaultRateLimitRpm) || current.defaultRateLimitRpm),
    defaultRateLimitTpm: Math.max(0, Number(input.defaultRateLimitTpm) || current.defaultRateLimitTpm),
    defaultMaxConcurrency: Math.max(0, Number(input.defaultMaxConcurrency) || current.defaultMaxConcurrency),
    globalBillingMultiplier: input.globalBillingMultiplier === undefined ? current.globalBillingMultiplier : Math.max(0, Number(input.globalBillingMultiplier) || 0),
    claudeBillingMultiplier: input.claudeBillingMultiplier === undefined ? current.claudeBillingMultiplier : Math.max(0, Number(input.claudeBillingMultiplier) || 0),
    openaiBillingMultiplier: input.openaiBillingMultiplier === undefined ? current.openaiBillingMultiplier : Math.max(0, Number(input.openaiBillingMultiplier) || 0),
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
    sub2apiBaseUrl: input.sub2apiBaseUrl ?? current.sub2apiBaseUrl,
    sub2apiAdminKey: input.sub2apiAdminKey === undefined ? current.sub2apiAdminKey : input.sub2apiAdminKey,
    notificationsAdminEnabled: input.notificationsAdminEnabled ?? current.notificationsAdminEnabled,
    serverChanUid: input.serverChanUid ?? current.serverChanUid,
    serverChanSendKey: input.serverChanSendKey === undefined ? current.serverChanSendKey : input.serverChanSendKey,
    platformIncidentCooldownMinutes: input.platformIncidentCooldownMinutes ?? current.platformIncidentCooldownMinutes,
    notifyAdminChannelCircuit: input.notifyAdminChannelCircuit ?? current.notifyAdminChannelCircuit,
    notifyAdminChannelCircuitRecovery: input.notifyAdminChannelCircuitRecovery ?? current.notifyAdminChannelCircuitRecovery,
    notifyAdminNoLiveChannel: input.notifyAdminNoLiveChannel ?? current.notifyAdminNoLiveChannel,
    notifyAdminNoLiveChannelRecovery: input.notifyAdminNoLiveChannelRecovery ?? current.notifyAdminNoLiveChannelRecovery,
    notifyAdminUpstreamExhausted: input.notifyAdminUpstreamExhausted ?? current.notifyAdminUpstreamExhausted,
    notifyAdminUpstreamExhaustedRecovery: input.notifyAdminUpstreamExhaustedRecovery ?? current.notifyAdminUpstreamExhaustedRecovery,
    notificationsUserEmailEnabled: input.notificationsUserEmailEnabled ?? current.notificationsUserEmailEnabled,
    notifyUserUsdBalance20: input.notifyUserUsdBalance20 ?? current.notifyUserUsdBalance20,
    notifyUserUsdBalance10: input.notifyUserUsdBalance10 ?? current.notifyUserUsdBalance10,
    notifyUserUsdBalance0: input.notifyUserUsdBalance0 ?? current.notifyUserUsdBalance0,
    notifyUserKeyQuota80: input.notifyUserKeyQuota80 ?? current.notifyUserKeyQuota80,
    notifyUserKeyQuota100: input.notifyUserKeyQuota100 ?? current.notifyUserKeyQuota100,
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

export function validPlatformIncidentCooldownMinutes(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1440;
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function secure(value: string | undefined): AppSettings["smtpSecure"] {
  return value === "none" || value === "ssl" || value === "starttls" ? value : defaults.smtpSecure;
}

function announcementMode(value: string | undefined): AppSettings["announcementMode"] {
  return value === "modal" || value === "marquee" ? value : defaults.announcementMode;
}

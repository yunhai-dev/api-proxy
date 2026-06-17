import { NextRequest, NextResponse } from "next/server";
import { AppSettings, getSettingsAsync, updateSettingsAsync } from "@/lib/settings";
import { pgDb, pgSchema } from "@/lib/db/pg";
import { AuthError, requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(publicSettings(await getSettingsAsync()));
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => ({}));
  const settings = await updateSettingsAsync({
    debugModels: typeof body.debugModels === "boolean" ? body.debugModels : undefined,
    proxyMaxRetries: body.proxyMaxRetries === undefined ? undefined : Number(body.proxyMaxRetries),
    proxyRetry429: typeof body.proxyRetry429 === "boolean" ? body.proxyRetry429 : undefined,
    proxyRetry5xx: typeof body.proxyRetry5xx === "boolean" ? body.proxyRetry5xx : undefined,
    proxyRetryNetwork: typeof body.proxyRetryNetwork === "boolean" ? body.proxyRetryNetwork : undefined,
    fallbackEnabled: typeof body.fallbackEnabled === "boolean" ? body.fallbackEnabled : undefined,
    fallbackChannelId: typeof body.fallbackChannelId === "string" ? body.fallbackChannelId.trim() : undefined,
    fallbackModel: typeof body.fallbackModel === "string" ? body.fallbackModel.trim() : undefined,
    recordAllRequestDetails: typeof body.recordAllRequestDetails === "boolean" ? body.recordAllRequestDetails : undefined,
    maintenanceMode: typeof body.maintenanceMode === "boolean" ? body.maintenanceMode : undefined,
    maintenanceMessage: typeof body.maintenanceMessage === "string" ? body.maintenanceMessage : undefined,
    defaultRateLimitRpm: body.defaultRateLimitRpm === undefined ? undefined : Number(body.defaultRateLimitRpm),
    defaultRateLimitTpm: body.defaultRateLimitTpm === undefined ? undefined : Number(body.defaultRateLimitTpm),
    defaultMaxConcurrency: body.defaultMaxConcurrency === undefined ? undefined : Number(body.defaultMaxConcurrency),
    globalBillingMultiplier: body.globalBillingMultiplier === undefined ? undefined : Number(body.globalBillingMultiplier),
    siteUrl: typeof body.siteUrl === "string" ? body.siteUrl.trim() : undefined,
    siteName: typeof body.siteName === "string" ? body.siteName.trim() : undefined,
    siteLogoUrl: typeof body.siteLogoUrl === "string" ? body.siteLogoUrl.trim() : undefined,
    announcementEnabled: typeof body.announcementEnabled === "boolean" ? body.announcementEnabled : undefined,
    announcementMode: body.announcementMode === "modal" || body.announcementMode === "marquee" ? body.announcementMode : undefined,
    announcementTitle: typeof body.announcementTitle === "string" ? body.announcementTitle.trim() : undefined,
    announcementHtml: typeof body.announcementHtml === "string" ? body.announcementHtml : undefined,
    smtpEnabled: typeof body.smtpEnabled === "boolean" ? body.smtpEnabled : undefined,
    smtpHost: typeof body.smtpHost === "string" ? body.smtpHost.trim() : undefined,
    smtpPort: body.smtpPort === undefined ? undefined : Number(body.smtpPort),
    smtpSecure: body.smtpSecure === "none" || body.smtpSecure === "ssl" || body.smtpSecure === "starttls" ? body.smtpSecure : undefined,
    smtpUser: typeof body.smtpUser === "string" ? body.smtpUser.trim() : undefined,
    smtpPassword: typeof body.smtpPassword === "string" && body.smtpPassword && body.smtpPassword !== "__configured__" ? body.smtpPassword : undefined,
    smtpFromEmail: typeof body.smtpFromEmail === "string" ? body.smtpFromEmail.trim() : undefined,
    smtpFromName: typeof body.smtpFromName === "string" ? body.smtpFromName.trim() : undefined,
  });
    await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: "更新系统设置", actor: actor.username });
    return NextResponse.json(publicSettings(settings));
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function publicSettings(settings: AppSettings) {
  return { ...settings, smtpPassword: settings.smtpPassword ? "__configured__" : "" };
}

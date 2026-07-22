import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { usePostgres } from "@/lib/db/runtime";
import { validateCapabilities } from "@/lib/protocol-capabilities";
import { validateUpstreamBaseUrl } from "@/lib/upstream";
import { AuthError, requireAdmin } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const body = await req.json().catch(() => ({}));
  let imported = 0;
  const pg = usePostgres() ? await import("@/lib/db/pg") : null;
  const mappingGroups = new Map<string, string>();
  for (const row of Array.isArray(body.modelMappings) ? body.modelMappings : []) {
    const groupId = typeof row?.groupId === "string" ? row.groupId.trim() : "";
    if (!groupId) continue;
    const signature = JSON.stringify({
      provider: row.provider,
      targetProvider: row.targetProvider === "claude" || row.targetProvider === "openai" ? row.targetProvider : row.provider,
      upstreamModel: row.upstreamModel,
      channelIds: Array.isArray(row.channelIds) ? [...new Set(row.channelIds)].sort() : [],
      enabled: row.enabled !== false,
    });
    const current = mappingGroups.get(groupId);
    if (current && current !== signature) return NextResponse.json({ error: `模型映射组配置不一致：${groupId}` }, { status: 400 });
    mappingGroups.set(groupId, signature);
  }

  for (const row of Array.isArray(body.channels) ? body.channels : []) {
    if (!row?.id || !row.name || !row.type || !row.baseUrl) continue;
    const capabilities = validateCapabilities(row.capabilities);
    if (!capabilities.ok || validateUpstreamBaseUrl(row.baseUrl)) continue;
    const openAiProtocol = row.type === "openai" && ["auto", "chat_completions", "responses"].includes(row.openAiProtocol)
      ? row.openAiProtocol as "auto" | "chat_completions" | "responses"
      : "auto" as const;
    const current = pg
      ? (await pg.pgDb.select().from(pg.pgSchema.channels).where(eq(pg.pgSchema.channels.id, row.id)).limit(1))[0]
      : db.select().from(schema.channels).where(eq(schema.channels.id, row.id)).get();
    const value = {
      id: row.id,
      name: row.name,
      type: row.type,
      openAiProtocol,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey || current?.apiKey || "",
      weight: Number(row.weight) || 1,
      maxConcurrency: Number(row.maxConcurrency) || 0,
      monitorIntervalSec: Number(row.monitorIntervalSec) || 0,
      testModel: row.testModel || "",
      models: Array.isArray(row.models) ? row.models : [],
      status: row.status === "warn" || row.status === "err" ? row.status : "ok",
      p50Ms: Number(row.p50Ms) || 0,
      errRate: Number(row.errRate) || 0,
      enabled: row.enabled !== false,
      capabilities: capabilities.capabilities ?? [],
    };
    if (pg) {
      if (current) await pg.pgDb.update(pg.pgSchema.channels).set(value).where(eq(pg.pgSchema.channels.id, row.id));
      else if (value.apiKey) await pg.pgDb.insert(pg.pgSchema.channels).values(value);
    } else if (current) db.update(schema.channels).set(value).where(eq(schema.channels.id, row.id)).run();
    else if (value.apiKey) db.insert(schema.channels).values(value).run();
    imported += 1;
  }

  for (const row of Array.isArray(body.modelMappings) ? body.modelMappings : []) {
    if (!row?.id || !row.provider || !row.inboundModel || !row.upstreamModel) continue;
    const value = {
      id: row.id,
      groupId: typeof row.groupId === "string" && row.groupId.trim() ? row.groupId.trim() : null,
      provider: row.provider,
      targetProvider: row.targetProvider === "claude" || row.targetProvider === "openai" ? row.targetProvider : row.provider,
      inboundModel: row.inboundModel,
      upstreamModel: row.upstreamModel,
      channelIds: Array.isArray(row.channelIds) ? row.channelIds : [],
      enabled: row.enabled !== false,
      createdAt: Number(row.createdAt) || Date.now(),
    };
    const current = pg
      ? (await pg.pgDb.select().from(pg.pgSchema.modelMappings).where(eq(pg.pgSchema.modelMappings.id, row.id)).limit(1))[0]
      : db.select().from(schema.modelMappings).where(eq(schema.modelMappings.id, row.id)).get();
    if (pg) {
      if (current) await pg.pgDb.update(pg.pgSchema.modelMappings).set(value).where(eq(pg.pgSchema.modelMappings.id, row.id));
      else await pg.pgDb.insert(pg.pgSchema.modelMappings).values(value);
    } else if (current) db.update(schema.modelMappings).set(value).where(eq(schema.modelMappings.id, row.id)).run();
    else db.insert(schema.modelMappings).values(value).run();
    imported += 1;
  }

  for (const row of Array.isArray(body.modelCatalog) ? body.modelCatalog : []) {
    if (!row?.id || !row.provider || !row.model) continue;
    const capabilities = validateCapabilities(row.capabilities);
    if (!capabilities.ok) continue;
    const now = Date.now();
    const value = {
      id: row.id,
      provider: row.provider,
      channelId: typeof row.channelId === "string" ? row.channelId : "",
      model: row.model,
      displayName: typeof row.displayName === "string" ? row.displayName : "",
      visible: row.visible !== false,
      enabled: row.enabled !== false,
      capabilities: capabilities.capabilities ?? [],
      createdAt: Number(row.createdAt) || now,
      updatedAt: now,
    };
    const current = pg
      ? (await pg.pgDb.select().from(pg.pgSchema.modelCatalog).where(eq(pg.pgSchema.modelCatalog.id, row.id)).limit(1))[0]
      : db.select().from(schema.modelCatalog).where(eq(schema.modelCatalog.id, row.id)).get();
    if (pg) {
      if (current) await pg.pgDb.update(pg.pgSchema.modelCatalog).set(value).where(eq(pg.pgSchema.modelCatalog.id, row.id));
      else await pg.pgDb.insert(pg.pgSchema.modelCatalog).values(value);
    } else if (current) db.update(schema.modelCatalog).set(value).where(eq(schema.modelCatalog.id, row.id)).run();
    else db.insert(schema.modelCatalog).values(value).run();
    imported += 1;
  }

  const importedSettings = Array.isArray(body.settings) ? body.settings : [];
  const settingKeys = new Set(importedSettings.map((row: { key?: unknown }) => row?.key));
  const legacyFallbackKeys: Record<string, string> = {
    fallbackEnabled: "FallbackEnabled",
    fallbackChannelId: "FallbackChannelId",
    fallbackModel: "FallbackModel",
  };
  const normalizedSettings = [...importedSettings];
  for (const [legacyKey, suffix] of Object.entries(legacyFallbackKeys)) {
    const legacy = importedSettings.find((row: { key?: unknown }) => row?.key === legacyKey);
    if (!legacy || typeof legacy.value !== "string") continue;
    for (const provider of ["claude", "openai"]) {
      const key = `${provider}${suffix}`;
      if (!settingKeys.has(key)) normalizedSettings.push({ key, value: legacy.value });
    }
  }
  for (const row of normalizedSettings) {
    if (!row?.key || typeof row.value !== "string" || row.key === "smtpPassword" || row.key === "sub2apiAdminKey" || row.key === "serverChanSendKey") continue;
    const value = { key: row.key, value: row.value, updatedAt: Date.now() };
    const current = pg
      ? (await pg.pgDb.select().from(pg.pgSchema.settings).where(eq(pg.pgSchema.settings.key, row.key)).limit(1))[0]
      : db.select().from(schema.settings).where(eq(schema.settings.key, row.key)).get();
    if (pg) {
      if (current) await pg.pgDb.update(pg.pgSchema.settings).set(value).where(eq(pg.pgSchema.settings.key, row.key));
      else await pg.pgDb.insert(pg.pgSchema.settings).values(value);
    } else if (current) db.update(schema.settings).set(value).where(eq(schema.settings.key, row.key)).run();
    else db.insert(schema.settings).values(value).run();
    imported += 1;
  }

  for (const row of Array.isArray(body.modelPrices) ? body.modelPrices : []) {
    if (!row?.id || !row.provider || !row.model) continue;
    const value = {
      id: row.id,
      provider: row.provider,
      model: row.model,
      inputPricePerMTok: Math.max(0, Number(row.inputPricePerMTok) || 0),
      outputPricePerMTok: Math.max(0, Number(row.outputPricePerMTok) || 0),
      cacheReadPricePerMTok: Math.max(0, Number(row.cacheReadPricePerMTok) || 0),
      cacheCreationPricePerMTok: Math.max(0, Number(row.cacheCreationPricePerMTok) || 0),
      updatedAt: Date.now(),
    };
    const current = pg
      ? (await pg.pgDb.select().from(pg.pgSchema.modelPrices).where(eq(pg.pgSchema.modelPrices.id, row.id)).limit(1))[0]
      : db.select().from(schema.modelPrices).where(eq(schema.modelPrices.id, row.id)).get();
    if (pg) {
      if (current) await pg.pgDb.update(pg.pgSchema.modelPrices).set(value).where(eq(pg.pgSchema.modelPrices.id, row.id));
      else await pg.pgDb.insert(pg.pgSchema.modelPrices).values(value);
    } else if (current) db.update(schema.modelPrices).set(value).where(eq(schema.modelPrices.id, row.id)).run();
    else db.insert(schema.modelPrices).values(value).run();
    imported += 1;
  }

  if (pg) await pg.pgDb.insert(pg.pgSchema.activities).values({ ts: Date.now(), event: `导入配置 ${imported} 项`, actor: actor.username });
  else db.insert(schema.activities).values({ ts: Date.now(), event: `导入配置 ${imported} 项`, actor: actor.username }).run();
  return NextResponse.json({ imported });
}

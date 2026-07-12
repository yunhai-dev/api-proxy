import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { resolveApiKeyAsync } from "@/lib/proxy";
import { getSettingsAsync } from "@/lib/settings";
import { hasModelCatalog, hasModelCatalogAsync, visibleModels, visibleModelsAsync } from "@/lib/model-catalog";
import { usePostgres } from "@/lib/db/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authFromHeaders(headers: Headers) {
  return headers.get("authorization")
    ?? headers.get("x-api-key")
    ?? headers.get("api-key");
}

function modelSourceFromRequest(req: NextRequest, keyScope?: string): "claude" | "openai" {
  const provider = req.nextUrl.searchParams.get("provider");
  if (provider === "claude" || provider === "openai") return provider;
  if (keyScope === "claude" || keyScope === "openai") return keyScope;
  return formatFromRequest(req);
}

function formatFromRequest(req: NextRequest, keyScope?: string): "claude" | "openai" {
  const format = req.nextUrl.searchParams.get("format");
  if (format === "claude" || format === "openai") return format;
  const headers = req.headers;
  if (headers.has("anthropic-version") || (headers.has("x-api-key") && !headers.has("authorization"))) return "claude";
  if (keyScope === "claude" || keyScope === "openai") return keyScope;
  return "openai";
}

function hasExplicitModelFormat(req: NextRequest) {
  const format = req.nextUrl.searchParams.get("format");
  const provider = req.nextUrl.searchParams.get("provider");
  return format === "claude" || format === "openai" || provider === "claude" || provider === "openai";
}

async function configuredModels(source: "claude" | "openai") {
  if (usePostgres()) {
    const catalogModels = await visibleModelsAsync(source);
    if (await hasModelCatalogAsync(source)) return catalogModels.map(model => ({ id: model.id, displayName: model.displayName }));
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    const rows = await pgDb.select({ models: pgSchema.channels.models }).from(pgSchema.channels).where(and(eq(pgSchema.channels.type, source), eq(pgSchema.channels.enabled, true)));
    return uniqueModels(rows.flatMap(row => row.models)).map(id => ({ id, displayName: id }));
  }
  const catalogModels = visibleModels(source);
  if (hasModelCatalog(source)) return catalogModels.map(model => ({ id: model.id, displayName: model.displayName }));
  const rows = db
    .select({ models: schema.channels.models })
    .from(schema.channels)
    .where(and(eq(schema.channels.type, source), eq(schema.channels.enabled, true)))
    .all();
  return uniqueModels(rows.flatMap(row => row.models)).map(id => ({ id, displayName: id }));
}

function uniqueModels(models: string[]) {
  return models
    .filter(model => model && model !== "*")
    .filter((model, index, all) => all.indexOf(model) === index)
    .sort();
}

function logModelResponse(input: { source: "claude" | "openai"; format: "claude" | "openai"; body: unknown; debug: boolean }) {
  if (!input.debug) return;
  console.info("[models] response", JSON.stringify({
    source: input.source,
    format: input.format,
    body: input.body,
  }));
}

function keyPrefix(rawAuth: string | null) {
  if (!rawAuth) return null;
  const token = rawAuth.replace(/^Bearer\s+/i, "").trim();
  return token.slice(0, 16);
}

function logModelRequest(req: NextRequest, input: { source: "claude" | "openai"; format: "claude" | "openai"; rawAuth: string | null; debug: boolean }) {
  if (!input.debug) return;
  console.info("[models] request", JSON.stringify({
    method: req.method,
    url: req.nextUrl.pathname,
    query: Object.fromEntries(req.nextUrl.searchParams.entries()),
    source: input.source,
    format: input.format,
    auth: input.rawAuth ? "present" : "missing",
    key_prefix: keyPrefix(input.rawAuth),
    headers: {
      authorization: req.headers.has("authorization") ? "present" : "missing",
      x_api_key: req.headers.has("x-api-key") ? "present" : "missing",
      api_key: req.headers.has("api-key") ? "present" : "missing",
      anthropic_version: req.headers.get("anthropic-version"),
    },
  }));
}

export async function GET(req: NextRequest) {
  const rawAuth = authFromHeaders(req.headers);
  const settings = await getSettingsAsync();
  const resolved = await resolveApiKeyAsync(rawAuth);
  const keyScope = resolved.ok ? resolved.key.channelScope : undefined;
  const source = modelSourceFromRequest(req, keyScope);
  const format = formatFromRequest(req, keyScope);
  logModelRequest(req, { source, format, rawAuth, debug: settings.debugModels });
  if (!resolved.ok) {
    if (format === "claude") {
      return NextResponse.json({ type: "error", error: { type: "invalid_request_error", message: resolved.error } }, { status: resolved.status });
    }
    return NextResponse.json({ error: { message: resolved.error, type: "invalid_request_error" } }, { status: resolved.status });
  }

  let models = await configuredModels(source);
  if (resolved.key.channelId) {
    const channel = usePostgres()
      ? (await (async () => {
        const { pgDb, pgSchema } = await import("@/lib/db/pg");
        return (await pgDb.select().from(pgSchema.channels).where(eq(pgSchema.channels.id, resolved.key.channelId!)).limit(1))[0];
      })())
      : db.select().from(schema.channels).where(eq(schema.channels.id, resolved.key.channelId)).get();
    if (!channel?.enabled || channel.type !== source) {
      const message = "供应商渠道不可用";
      if (format === "claude") return NextResponse.json({ type: "error", error: { type: "invalid_request_error", message } }, { status: 403 });
      return NextResponse.json({ error: { message, type: "invalid_request_error" } }, { status: 403 });
    }
    const allowed = new Set(uniqueModels(channel.models));
    models = models.filter(model => allowed.has(model.id));
  }
  if (format === "openai" && source === "openai" && models.length === 0 && !hasExplicitModelFormat(req) && !resolved.key.channelId) {
    const claudeModels = await configuredModels("claude");
    if (claudeModels.length > 0) {
      models = claudeModels;
      logModelRequest(req, { source: "claude", format: "claude", rawAuth, debug: settings.debugModels });
      const body = {
        data: models.map(model => ({ id: model.id, type: "model", display_name: model.displayName, created_at: "1970-01-01T00:00:00Z" })),
        object: "list",
      };
      logModelResponse({ source: "claude", format: "claude", body, debug: settings.debugModels });
      return NextResponse.json(body);
    }
  }
  if (format === "claude") {
    const body = {
      data: models.map(model => ({ id: model.id, type: "model", display_name: model.displayName, created_at: "1970-01-01T00:00:00Z" })),
      object: "list",
    };
    logModelResponse({ source, format, body, debug: settings.debugModels });
    return NextResponse.json(body);
  }

  const created = Math.floor(Date.now() / 1000);
  const body = {
    object: "list",
    data: models.map(model => ({ id: model.id, object: "model", created, owned_by: "api-proxy" })),
  };
  logModelResponse({ source, format, body, debug: settings.debugModels });
  return NextResponse.json(body);
}

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { listedModels, listedModelsAsync } from "@/lib/model-catalog";
import { usePostgres } from "@/lib/db/runtime";
import { pageParams, pageRows, queryText, sortRows } from "@/lib/pagination";

export const dynamic = "force-dynamic";

type Provider = "claude" | "openai";

function providerFrom(input: unknown): Provider | null {
  return input === "claude" || input === "openai" ? input : null;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { hasPagination, page, pageSize } = pageParams(req.nextUrl);
    const q = queryText(req.nextUrl, "query", "search").toLowerCase();
    const visible = req.nextUrl.searchParams.get("visible") ?? "all";
    const enabled = req.nextUrl.searchParams.get("enabled") ?? "all";
    const source = req.nextUrl.searchParams.get("source") ?? "all";
    const provider = providerFrom(req.nextUrl.searchParams.get("provider"));
    const providers: Provider[] = provider ? [provider] : ["claude", "openai"];
    if (usePostgres()) {
      const rows = await Promise.all(providers.map(async p => (await listedModelsAsync(p)).map(model => ({ provider: p, ...model }))));
      const filtered = sortModels(req.nextUrl, filterModels(rows.flat(), q, visible, enabled, source));
      return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered);
    }
    const rows = providers.flatMap(p => listedModels(p).map(model => ({ provider: p, ...model })));
    const filtered = sortModels(req.nextUrl, filterModels(rows, q, visible, enabled, source));
    return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function filterModels<T extends { id: string; displayName: string; visible: boolean; enabled: boolean; configured: boolean }>(rows: T[], q: string, visible: string, enabled: string, source: string) {
  return rows.filter(row => {
    const matchesQuery = !q || [row.id, row.displayName].some(value => value.toLowerCase().includes(q));
    const matchesVisible = visible === "all" || (visible === "visible" ? row.visible : !row.visible);
    const matchesEnabled = enabled === "all" || (enabled === "enabled" ? row.enabled : !row.enabled);
    const matchesSource = source === "all" || (source === "configured" ? row.configured : !row.configured);
    return matchesQuery && matchesVisible && matchesEnabled && matchesSource;
  });
}

function sortModels<T extends { provider: string; id: string; displayName: string; visible: boolean; enabled: boolean; configured: boolean }>(url: URL, rows: T[]) {
  return sortRows(url, rows, {
    provider: row => row.provider,
    id: row => row.id,
    displayName: row => row.displayName,
    visible: row => row.visible,
    enabled: row => row.enabled,
    configured: row => row.configured,
  }, "id");
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const provider = providerFrom(body.provider);
    if (!provider) return NextResponse.json({ error: "请选择服务商" }, { status: 400 });
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model) return NextResponse.json({ error: "请输入模型名称" }, { status: 400 });
    const now = Date.now();
    const value = {
      provider,
      model,
      displayName: typeof body.displayName === "string" ? body.displayName.trim() : "",
      visible: body.visible !== false,
      enabled: body.enabled !== false,
      updatedAt: now,
    };
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const current = (await pgDb.select().from(pgSchema.modelCatalog).where(and(eq(pgSchema.modelCatalog.provider, provider), eq(pgSchema.modelCatalog.model, model))).limit(1))[0];
      if (current) {
        await pgDb.update(pgSchema.modelCatalog).set(value).where(eq(pgSchema.modelCatalog.id, current.id));
        await pgDb.insert(pgSchema.activities).values({ ts: now, event: `更新模型 ${provider}:${model}`, actor: actor.username });
        return NextResponse.json({ ...current, ...value });
      }
      const row = { id: "mc_" + nanoid(8), ...value, createdAt: now };
      await pgDb.insert(pgSchema.modelCatalog).values(row);
      await pgDb.insert(pgSchema.activities).values({ ts: now, event: `添加模型 ${provider}:${model}`, actor: actor.username });
      return NextResponse.json(row, { status: 201 });
    }
    const current = db
      .select()
      .from(schema.modelCatalog)
      .where(and(eq(schema.modelCatalog.provider, provider), eq(schema.modelCatalog.model, model)))
      .get();
    if (current) {
      db.update(schema.modelCatalog).set(value).where(eq(schema.modelCatalog.id, current.id)).run();
      db.insert(schema.activities).values({ ts: now, event: `更新模型 ${provider}:${model}`, actor: actor.username }).run();
      return NextResponse.json({ ...current, ...value });
    }
    const row = { id: "mc_" + nanoid(8), ...value, createdAt: now };
    db.insert(schema.modelCatalog).values(row).run();
    db.insert(schema.activities).values({ ts: now, event: `添加模型 ${provider}:${model}`, actor: actor.username }).run();
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "操作失败，请稍后重试" }, { status: 500 });
  }
}

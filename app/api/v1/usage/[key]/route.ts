import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { resolveApiKeyAsync, resolveToken } from "@/lib/proxy";
import { usePostgres } from "@/lib/db/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 用量查询（按 key + 时间窗聚合）
 * GET /api/v1/usage/:keyId?range=24h|7d|30d
 * Authorization: Bearer sk-relay-XXX
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  const { key: keyParam } = await ctx.params;
  const range = (req.nextUrl.searchParams.get("range") ?? "24h") as "24h" | "7d" | "30d";
  const windowMs = range === "7d" ? 7 * 86_400_000 : range === "30d" ? 30 * 86_400_000 : 86_400_000;
  const since = Date.now() - windowMs;

  // keyParam 可以是 keyId (k_xxx) 或 fullKey
  // 先试 keyId，再试 fullKey/prefix
  let resolved = usePostgres() ? await resolveApiKeyAsync(keyParam) : resolveToken(keyParam);
  if (!resolved.ok) {
    // 尝试当作 keyId 直查
    const byId = usePostgres()
      ? await (async () => {
        const { pgDb, pgSchema } = await import("@/lib/db/pg");
        return (await pgDb.select().from(pgSchema.keys).where(eq(pgSchema.keys.id, keyParam)).limit(1))[0];
      })()
      : db.select().from(schema.keys).where(eq(schema.keys.id, keyParam)).get();
    if (byId) resolved = { ok: true, key: byId as typeof schema.keys.$inferSelect };
  }
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const key = resolved.key;

  const rows = usePostgres()
    ? await (async () => {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      return pgDb
        .select({
          model: pgSchema.requestStats.model,
          status: pgSchema.requestStats.status,
          tokensIn: pgSchema.requestStats.tokensIn,
          tokensOut: pgSchema.requestStats.tokensOut,
          cacheTokens: pgSchema.requestStats.cacheTokens,
          cacheReadTokens: pgSchema.requestStats.cacheReadTokens,
          cacheCreationTokens: pgSchema.requestStats.cacheCreationTokens,
        })
        .from(pgSchema.requestStats)
        .where(and(eq(pgSchema.requestStats.keyId, key.id), gte(pgSchema.requestStats.ts, since)));
    })()
    : db
      .select({
        model: schema.requestLogs.model,
        status: schema.requestLogs.status,
        tokensIn: schema.requestLogs.tokensIn,
        tokensOut: schema.requestLogs.tokensOut,
        cacheTokens: schema.requestLogs.cacheTokens,
        cacheReadTokens: schema.requestLogs.cacheReadTokens,
        cacheCreationTokens: schema.requestLogs.cacheCreationTokens,
      })
      .from(schema.requestLogs)
      .where(and(eq(schema.requestLogs.keyId, key.id), gte(schema.requestLogs.ts, since)))
      .all();

  const summary = rows.reduce((acc, r) => {
    acc.requests += 1;
    acc.tokensIn += r.tokensIn;
    acc.tokensOut += r.tokensOut;
    acc.cacheReadTokens += r.cacheReadTokens;
    acc.cacheCreationTokens += r.cacheCreationTokens;
    acc.cacheTokens += r.cacheReadTokens + r.cacheCreationTokens;
    if (r.status >= 200 && r.status < 300) acc.success += 1;
    else acc.error += 1;
    return acc;
  }, { requests: 0, tokensIn: 0, tokensOut: 0, cacheTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, success: 0, error: 0 });

  const modelMap = new Map<string, { model: string; requests: number; tokensIn: number; tokensOut: number; cacheTokens: number; cacheReadTokens: number; cacheCreationTokens: number }>();
  for (const r of rows) {
    const cur = modelMap.get(r.model) ?? { model: r.model, requests: 0, tokensIn: 0, tokensOut: 0, cacheTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    cur.requests += 1;
    cur.tokensIn += r.tokensIn;
    cur.tokensOut += r.tokensOut;
    cur.cacheReadTokens += r.cacheReadTokens;
    cur.cacheCreationTokens += r.cacheCreationTokens;
    cur.cacheTokens += r.cacheReadTokens + r.cacheCreationTokens;
    modelMap.set(r.model, cur);
  }

  return NextResponse.json({
    keyId: key.id,
    keyName: key.name,
    quota: key.quota,
    used: key.used,
    range,
    since,
    summary,
    byModel: [...modelMap.values()],
  });
}

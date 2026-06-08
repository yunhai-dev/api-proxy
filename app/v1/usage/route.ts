import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { resolveApiKeyAsync } from "@/lib/proxy";
import { usePostgres } from "@/lib/db/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const resolved = await resolveApiKeyAsync(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const key = resolved.key;
  const quota = key.userId
    ? usePostgres()
      ? await (async () => {
        const { pgDb, pgSchema } = await import("@/lib/db/pg");
        return (await pgDb.select().from(pgSchema.userQuotas).where(eq(pgSchema.userQuotas.userId, key.userId)).limit(1))[0];
      })()
      : db.select().from(schema.userQuotas).where(eq(schema.userQuotas.userId, key.userId)).get()
    : null;
  const user = key.userId
    ? usePostgres()
      ? await (async () => {
        const { pgDb, pgSchema } = await import("@/lib/db/pg");
        return (await pgDb.select().from(pgSchema.users).where(eq(pgSchema.users.id, key.userId)).limit(1))[0];
      })()
      : db.select().from(schema.users).where(eq(schema.users.id, key.userId)).get()
    : null;

  const quotaUsd = quota?.quotaUsd ?? 0;
  const usedUsd = quota?.usedUsd ?? 0;

  return NextResponse.json({
    remaining: Math.max(0, quotaUsd - usedUsd),
    unit: "USD",
    is_active: key.status === "active" && (!user || user.status === "active"),
    total_used: usedUsd,
    expires_at: null,
  });
}

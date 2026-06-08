import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { AuthError, requireAdmin } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      return NextResponse.json(await pgDb.select().from(pgSchema.modelPrices));
    }
    return NextResponse.json(db.select().from(schema.modelPrices).all());
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => ({}));
  const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
  let provider = body.provider === "claude" || body.provider === "openai" ? body.provider as "claude" | "openai" : null;
  if (channelId) {
    const channel = usePostgres()
      ? await (async () => {
        const { pgDb, pgSchema } = await import("@/lib/db/pg");
        return (await pgDb.select().from(pgSchema.channels).where(eq(pgSchema.channels.id, channelId)).limit(1))[0];
      })()
      : db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
    if (!channel) return NextResponse.json({ error: "请选择有效渠道" }, { status: 400 });
    provider = channel.type as "claude" | "openai";
  }
  if (!provider) return NextResponse.json({ error: "请选择服务商" }, { status: 400 });
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return NextResponse.json({ error: "请输入模型" }, { status: 400 });
  const value = {
    id: "mp_" + nanoid(8),
    provider,
    channelId,
    model,
    inputPricePerMTok: Math.max(0, Number(body.inputPricePerMTok) || 0),
    outputPricePerMTok: Math.max(0, Number(body.outputPricePerMTok) || 0),
    cacheReadPricePerMTok: Math.max(0, Number(body.cacheReadPricePerMTok) || 0),
    cacheCreationPricePerMTok: Math.max(0, Number(body.cacheCreationPricePerMTok) || 0),
    updatedAt: Date.now(),
  };
  if (usePostgres()) {
    const { pgDb, pgSchema } = await import("@/lib/db/pg");
    const current = (await pgDb.select().from(pgSchema.modelPrices).where(and(eq(pgSchema.modelPrices.channelId, value.channelId), eq(pgSchema.modelPrices.model, value.model))).limit(1))[0];
    if (current) return NextResponse.json({ error: "该渠道下该模型已配置定价，请先删除旧定价" }, { status: 409 });
    await pgDb.insert(pgSchema.modelPrices).values(value);
    await pgDb.insert(pgSchema.activities).values({ ts: Date.now(), event: `更新模型定价 ${value.channelId || value.provider}:${value.model}`, actor: actor.username });
    return NextResponse.json(value, { status: 201 });
  }
  const current = db.select().from(schema.modelPrices).where(and(eq(schema.modelPrices.channelId, value.channelId), eq(schema.modelPrices.model, value.model))).get();
  if (current) return NextResponse.json({ error: "该渠道下该模型已配置定价，请先删除旧定价" }, { status: 409 });
  db.insert(schema.modelPrices).values(value).run();
    db.insert(schema.activities).values({ ts: Date.now(), event: `更新模型定价 ${value.channelId || value.provider}:${value.model}`, actor: actor.username }).run();
    return NextResponse.json(value, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { AuthError, requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { usePostgres } from "@/lib/db/runtime";
import { hashGiftCardCode } from "@/lib/gift-cards";
import { insertDefaultUserQuotaAsync } from "@/lib/user-quota";
import { rearmUserThresholds } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code : "";
    const codeHash = hashGiftCardCode(code);
    if (!code.trim()) return NextResponse.json({ error: "请输入礼品卡卡号" }, { status: 400 });
    const now = Date.now();

    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const card = (await pgDb.select().from(pgSchema.giftCards).where(eq(pgSchema.giftCards.codeHash, codeHash)).limit(1))[0];
      if (!card) return NextResponse.json({ error: "礼品卡不存在" }, { status: 404 });
      if (card.status !== "active") return NextResponse.json({ error: "礼品卡已被核销" }, { status: 409 });
      let quota = (await pgDb.select().from(pgSchema.userQuotas).where(eq(pgSchema.userQuotas.userId, user.id)).limit(1))[0];
      if (!quota) {
        await insertDefaultUserQuotaAsync(user.id, now);
        quota = (await pgDb.select().from(pgSchema.userQuotas).where(eq(pgSchema.userQuotas.userId, user.id)).limit(1))[0];
      }
      await pgDb.transaction(async tx => {
        await tx.update(pgSchema.giftCards).set({ status: "redeemed", redeemedBy: user.id, redeemedAt: now }).where(eq(pgSchema.giftCards.id, card.id));
        await tx.update(pgSchema.userQuotas).set({ quotaUsd: (quota?.quotaUsd ?? 0) + card.amountUsd, updatedAt: now }).where(eq(pgSchema.userQuotas.userId, user.id));
        await rearmUserThresholds({ kind: "user-usd", ownerId: user.id, used: quota?.usedUsd ?? 0, quota: (quota?.quotaUsd ?? 0) + card.amountUsd, writer: tx });
        await tx.insert(pgSchema.activities).values({ ts: now, event: `核销礼品卡 $${card.amountUsd.toFixed(2)}`, actor: user.username });
      });
      return NextResponse.json({ ok: true, amountUsd: card.amountUsd, quotaUsd: (quota?.quotaUsd ?? 0) + card.amountUsd });
    }

    const card = db.select().from(schema.giftCards).where(eq(schema.giftCards.codeHash, codeHash)).get();
    if (!card) return NextResponse.json({ error: "礼品卡不存在" }, { status: 404 });
    if (card.status !== "active") return NextResponse.json({ error: "礼品卡已被核销" }, { status: 409 });
    let quota = db.select().from(schema.userQuotas).where(eq(schema.userQuotas.userId, user.id)).get();
    if (!quota) {
      await insertDefaultUserQuotaAsync(user.id, now);
      quota = db.select().from(schema.userQuotas).where(eq(schema.userQuotas.userId, user.id)).get();
    }
    db.update(schema.giftCards).set({ status: "redeemed", redeemedBy: user.id, redeemedAt: now }).where(eq(schema.giftCards.id, card.id)).run();
    db.update(schema.userQuotas).set({ quotaUsd: (quota?.quotaUsd ?? 0) + card.amountUsd, updatedAt: now }).where(eq(schema.userQuotas.userId, user.id)).run();
    db.insert(schema.activities).values({ ts: now, event: `核销礼品卡 $${card.amountUsd.toFixed(2)}`, actor: user.username }).run();
    return NextResponse.json({ ok: true, amountUsd: card.amountUsd, quotaUsd: (quota?.quotaUsd ?? 0) + card.amountUsd });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

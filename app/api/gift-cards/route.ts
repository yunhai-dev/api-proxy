import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { desc, inArray } from "drizzle-orm";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { usePostgres } from "@/lib/db/runtime";
import { createGiftCardCode, giftCardCodeParts, hashGiftCardCode } from "@/lib/gift-cards";
import { pageParams, pageRows, queryText, sortRows } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { hasPagination, page, pageSize } = pageParams(req.nextUrl);
    const q = queryText(req.nextUrl, "query", "search").toLowerCase();
    const status = req.nextUrl.searchParams.get("status") ?? "all";
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      const rows = await pgDb.select().from(pgSchema.giftCards).orderBy(desc(pgSchema.giftCards.createdAt));
      const filtered = sortGiftCards(req.nextUrl, filterGiftCards(rows, q, status));
      return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered.slice(0, 200));
    }
    const rows = db.select().from(schema.giftCards).orderBy(desc(schema.giftCards.createdAt)).all();
    const filtered = sortGiftCards(req.nextUrl, filterGiftCards(rows, q, status));
    return NextResponse.json(hasPagination ? pageRows(filtered, page, pageSize) : filtered.slice(0, 200));
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function filterGiftCards<T extends { codePrefix: string; codeSuffix: string; status: string; createdBy: string; redeemedBy: string | null }>(rows: T[], q: string, status: string) {
  return rows.filter(row => {
    const code = `${row.codePrefix}${row.codeSuffix}`.toLowerCase();
    const matchesQuery = !q || code.includes(q) || row.createdBy.toLowerCase().includes(q) || (row.redeemedBy ?? "").toLowerCase().includes(q);
    const matchesStatus = status === "all" || row.status === status;
    return matchesQuery && matchesStatus;
  });
}

function sortGiftCards<T extends { codePrefix: string; codeSuffix: string; amountUsd: number; status: string; createdAt: number; redeemedBy: string | null; redeemedAt: number | null }>(url: URL, rows: T[]) {
  return sortRows(url, rows, {
    code: row => `${row.codePrefix}${row.codeSuffix}`,
    amountUsd: row => row.amountUsd,
    status: row => row.status,
    createdAt: row => row.createdAt,
    redeemedBy: row => row.redeemedBy ?? "",
    redeemedAt: row => row.redeemedAt ?? 0,
  }, "createdAt", "desc");
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const amountUsd = Math.round((Number(body.amountUsd) || 0) * 100) / 100;
    const count = Math.min(100, Math.max(1, Math.floor(Number(body.count) || 1)));
    if (amountUsd <= 0) return NextResponse.json({ error: "请输入大于 0 的礼品卡金额" }, { status: 400 });
    const now = Date.now();
    const cards = Array.from({ length: count }, () => {
      const code = createGiftCardCode();
      const parts = giftCardCodeParts(code);
      return {
        id: "gc_" + nanoid(10),
        code,
        row: {
          id: "gc_" + nanoid(10),
          codeHash: hashGiftCardCode(code),
          codePrefix: parts.prefix,
          codeSuffix: parts.suffix,
          amountUsd,
          status: "active" as const,
          createdBy: actor.id,
          redeemedBy: null,
          redeemedAt: null,
          createdAt: now,
        },
      };
    });
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      await pgDb.insert(pgSchema.giftCards).values(cards.map(card => card.row));
      await pgDb.insert(pgSchema.activities).values({ ts: now, event: `生成礼品卡 ${count} 张 / $${amountUsd.toFixed(2)}`, actor: actor.username });
    } else {
      for (const card of cards) db.insert(schema.giftCards).values(card.row).run();
      db.insert(schema.activities).values({ ts: now, event: `生成礼品卡 ${count} 张 / $${amountUsd.toFixed(2)}`, actor: actor.username }).run();
    }
    return NextResponse.json({ cards: cards.map(card => ({ ...card.row, code: card.code })) }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0) : [];
    if (ids.length === 0) return NextResponse.json({ error: "请选择要删除的礼品卡" }, { status: 400 });
    const now = Date.now();
    if (usePostgres()) {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      await pgDb.delete(pgSchema.giftCards).where(inArray(pgSchema.giftCards.id, ids));
      await pgDb.insert(pgSchema.activities).values({ ts: now, event: `删除礼品卡 ${ids.length} 张`, actor: actor.username });
    } else {
      db.delete(schema.giftCards).where(inArray(schema.giftCards.id, ids)).run();
      db.insert(schema.activities).values({ ts: now, event: `删除礼品卡 ${ids.length} 张`, actor: actor.username }).run();
    }
    return NextResponse.json({ deleted: ids.length });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

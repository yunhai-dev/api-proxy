import { NextResponse } from "next/server";
import { getLogDetailAsync } from "@/lib/stats";
import { AuthError, isAdmin, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: rawId } = await ctx.params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "日志ID无效" }, { status: 400 });

    const detail = await getLogDetailAsync(id, isAdmin(user) ? {} : { userId: user.id });
    if (!detail) return NextResponse.json({ error: "日志不存在" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth";
import { getSettingsAsync } from "@/lib/settings";
import { getSub2ApiAccount, listSub2ApiAccounts, parseSub2ApiPage, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const settings = await getSettingsAsync();
    const config = { baseUrl: settings.sub2apiBaseUrl, adminKey: settings.sub2apiAdminKey };
    const idParam = req.nextUrl.searchParams.get("id");
    if (idParam !== null) {
      const id = Number(idParam);
      if (!Number.isInteger(id) || id < 1) throw new Sub2ApiError("账号 ID 无效", 400);
      return NextResponse.json(await getSub2ApiAccount(config, id));
    }
    const { page, pageSize } = parseSub2ApiPage(req.nextUrl.searchParams.get("page"), req.nextUrl.searchParams.get("pageSize"));
    const platform = cleanFilter(req.nextUrl.searchParams.get("platform"));
    const status = cleanFilter(req.nextUrl.searchParams.get("status"));
    const search = (req.nextUrl.searchParams.get("search") ?? "").trim().slice(0, 100);
    return NextResponse.json({
      ...await listSub2ApiAccounts(config, { page, pageSize, platform, status, search }),
      updatedAt: Date.now(),
    });
  } catch (error) {
    if (error instanceof AuthError || error instanceof Sub2ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

function cleanFilter(value: string | null) {
  const cleaned = (value ?? "").trim();
  if (cleaned.length > 50 || !/^[\w.-]*$/.test(cleaned)) throw new Sub2ApiError("筛选参数无效", 400);
  return cleaned;
}

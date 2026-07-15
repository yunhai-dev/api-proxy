import { NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth";
import { getSettingsAsync } from "@/lib/settings";
import { getSub2ApiStatus, Sub2ApiError } from "@/lib/sub2api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const settings = await getSettingsAsync();
    return NextResponse.json(await getSub2ApiStatus({ baseUrl: settings.sub2apiBaseUrl, adminKey: settings.sub2apiAdminKey }));
  } catch (error) {
    if (error instanceof AuthError || error instanceof Sub2ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

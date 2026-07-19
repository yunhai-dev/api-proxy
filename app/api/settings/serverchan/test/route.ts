import { NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth";
import { getSettingsAsync } from "@/lib/settings";
import { sendServerChan, validServerChanUid } from "@/lib/notifications";

export async function POST() {
  try {
    await requireAdmin();
    const settings = await getSettingsAsync();
    if (!validServerChanUid(settings.serverChanUid) || !settings.serverChanSendKey) {
      return NextResponse.json({ error: "请先保存有效的 ServerChan UID 和 SendKey" }, { status: 400 });
    }
    await sendServerChan(settings.serverChanUid, settings.serverChanSendKey, `${settings.siteName} 测试通知`, "ServerChan 通知配置可用。所有生产通知仍受各自开关控制。");
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "ServerChan 发送失败，请检查配置后重试" }, { status: 502 });
  }
}

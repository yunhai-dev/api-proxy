import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth";
import { getSettingsAsync } from "@/lib/settings";
import { sendMail } from "@/lib/mailer";
import { smtpTestMail } from "@/lib/mail-templates";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const to = typeof body.to === "string" ? body.to.trim() : "";
    if (!to) return NextResponse.json({ error: "请输入测试收件邮箱" }, { status: 400 });
    const settings = await getSettingsAsync();
    await sendMail(settings, {
      to,
      ...smtpTestMail(settings.siteName),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "邮件发送失败，请检查 SMTP 配置后重试" }, { status: 502 });
  }
}

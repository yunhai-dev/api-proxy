import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth";
import { drainNotificationOutbox } from "@/lib/notifications";

function validWorkerSecret(req: NextRequest) {
  const expected = process.env.NOTIFICATION_WORKER_SECRET ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  const actual = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !actual || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export async function POST(req: NextRequest) {
  if (!validWorkerSecret(req)) {
    try {
      await requireAdmin();
    } catch (error) {
      if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }
  return NextResponse.json({ processed: await drainNotificationOutbox() });
}

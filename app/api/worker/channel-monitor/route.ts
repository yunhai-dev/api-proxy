import { NextResponse } from "next/server";
import { ensureChannelMonitor, runChannelMonitorTick } from "@/lib/channel-monitor";

export async function POST() {
  ensureChannelMonitor();
  await runChannelMonitorTick();
  return NextResponse.json({ ok: true });
}

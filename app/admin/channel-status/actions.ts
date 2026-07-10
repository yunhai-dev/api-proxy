"use server";

import { getChannelHealthAsync } from "@/lib/stats";
import { requireAdmin } from "@/lib/auth";

export async function loadChannelHealth({ since, until }: { since: number; until: number }) {
  await requireAdmin();
  return getChannelHealthAsync({ since, until });
}

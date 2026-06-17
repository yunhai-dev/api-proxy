import { logHub } from "@/lib/log-generator";
import { AuthError, isAdmin, requireUser } from "@/lib/auth";
import { requestedUserId, scopedUserId } from "@/lib/scope";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { usePostgres } from "@/lib/db/runtime";
import type { LogListEntry } from "@/lib/types";

function userLogEntry(row: LogListEntry) {
  const model = row.inboundModel || row.model;
  return {
    id: row.id,
    requestId: row.requestId,
    ts: row.ts,
    keyId: row.keyId,
    keyName: row.keyName,
    keyPrefix: row.keyPrefix,
    channelId: row.channelId,
    channelName: row.channelType,
    channelType: row.channelType,
    model,
    inboundModel: model,
    status: row.status,
    latencyMs: row.latencyMs,
    ttftMs: row.ttftMs,
    durationMs: row.durationMs,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    cacheTokens: row.cacheTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    hasDetail: row.hasDetail,
    cost: row.cost,
  };
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  let userId = "";
  let admin = false;
  try {
    const user = await requireUser();
    admin = isAdmin(user);
    userId = scopedUserId(user, requestedUserId(new URL(req.url)));
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let closeStream = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let unsub = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* closed */ }
      };

      send("ready", { ts: Date.now() });

      unsub = logHub.subscribe((entry) => {
        void (async () => {
          let scopedKey: { userId: string; userName?: string | null; username?: string | null } | undefined;
          if (userId || admin) {
            scopedKey = usePostgres()
              ? await (async () => {
                const { pgDb, pgSchema } = await import("@/lib/db/pg");
                return (await pgDb
                  .select({ userId: pgSchema.keys.userId, userName: pgSchema.users.displayName, username: pgSchema.users.username })
                  .from(pgSchema.keys)
                  .leftJoin(pgSchema.users, eq(pgSchema.users.id, pgSchema.keys.userId))
                  .where(eq(pgSchema.keys.id, entry.keyId))
                  .limit(1))[0];
              })()
              : db
                .select({ userId: schema.keys.userId, userName: schema.users.displayName, username: schema.users.username })
                .from(schema.keys)
                .leftJoin(schema.users, eq(schema.users.id, schema.keys.userId))
                .where(eq(schema.keys.id, entry.keyId))
                .get();
            if (userId && scopedKey?.userId !== userId) return;
          }
          const adminEntry = admin ? {
            ...entry,
            userName: scopedKey?.userName ?? scopedKey?.username ?? entry.userName ?? "未知用户",
            username: scopedKey?.username ?? entry.username ?? "",
          } : entry;
          send("log", admin ? adminEntry : userLogEntry(entry));
        })();
      });

      // 心跳
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch { /* closed */ }
      }, 15000);

      // 关闭
      const close = () => {
        if (heartbeat) clearInterval(heartbeat);
        unsub();
        try { controller.close(); } catch { /* */ }
      };
      closeStream = close;
    },
    cancel() {
      closeStream();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

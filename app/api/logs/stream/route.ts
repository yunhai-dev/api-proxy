import { logHub } from "@/lib/log-generator";
import { AuthError, isAdmin, requireUser } from "@/lib/auth";
import { requestedUserId, scopedUserId } from "@/lib/scope";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { usePostgres } from "@/lib/db/runtime";

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
          if (userId) {
            const key = usePostgres()
              ? await (async () => {
                const { pgDb, pgSchema } = await import("@/lib/db/pg");
                return (await pgDb.select({ userId: pgSchema.keys.userId }).from(pgSchema.keys).where(eq(pgSchema.keys.id, entry.keyId)).limit(1))[0];
              })()
              : db.select({ userId: schema.keys.userId }).from(schema.keys).where(eq(schema.keys.id, entry.keyId)).get();
            if (key?.userId !== userId) return;
          }
          send("log", admin ? entry : { ...entry, channelName: entry.channelType });
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

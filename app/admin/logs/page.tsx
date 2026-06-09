import { PageHead } from "@/components/page-head";
import { LogStream } from "@/components/logs/log-stream";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getRecentLogsAsync } from "@/lib/stats";
import { usePostgres } from "@/lib/db/runtime";

export const dynamic = "force-dynamic";

export default async function AdminLogsPage() {
  await requireAdmin();
  const users = usePostgres()
    ? await (async () => {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      return pgDb.select({ id: pgSchema.users.id, username: pgSchema.users.username, displayName: pgSchema.users.displayName }).from(pgSchema.users);
    })()
    : db.select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName }).from(schema.users).all();
  const initial = await getRecentLogsAsync(50);
  return (
    <div className="container data-container">
      <PageHead
        title="管理请求日志"
        sub={
          <>
            <span>全局日志流</span>
            <span className="sep">/</span>
            <span className="mono dim">支持按用户筛选</span>
          </>
        }
      />
      <LogStream initial={initial} mode="admin" users={users} />
    </div>
  );
}

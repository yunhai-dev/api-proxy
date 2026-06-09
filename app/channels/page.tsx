import { PageHead } from "@/components/page-head";
import { db, schema } from "@/lib/db";
import { ChannelsTable } from "@/components/channels/channels-table";
import { requireAdmin } from "@/lib/auth";
import { usePostgres } from "@/lib/db/runtime";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  await requireAdmin();
  const all = usePostgres()
    ? await (async () => {
      const { pgDb, pgSchema } = await import("@/lib/db/pg");
      return pgDb.select().from(pgSchema.channels);
    })()
    : db.select().from(schema.channels).all();
  const enabled = all.filter(c => c.enabled).length;
  const throttled = all.filter(c => c.status === "warn").length;
  const degraded = all.filter(c => c.status === "err").length;

  return (
    <div className="container data-container">
      <PageHead
        title="渠道"
        sub={
          <>
            <span>上游服务商</span>
            <span className="sep">/</span>
            <span>共 {all.length} 个</span>
            <span className="sep">/</span>
            <span>{enabled} 个启用，{throttled} 个限流，{degraded} 个降级</span>
          </>
        }
      />
      <ChannelsTable />
    </div>
  );
}

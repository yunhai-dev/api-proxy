import { PageHead } from "@/components/page-head";
import { AuditTable } from "@/components/audit/audit-table";
import { getRecentActivityAsync } from "@/lib/stats";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requireAdmin();
  const activity = await getRecentActivityAsync(100);

  return (
    <div className="container data-container">
      <PageHead
        title="审计日志"
        sub={
          <>
            <span>管理操作记录</span>
            <span className="sep">/</span>
            <span>{activity.length.toLocaleString()} 条</span>
          </>
        }
      />

      <AuditTable rows={activity} />
    </div>
  );
}

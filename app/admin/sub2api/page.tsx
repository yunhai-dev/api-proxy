import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { PageHead } from "@/components/page-head";
import { Sub2ApiStatusView } from "@/components/sub2api/sub2api-status-view";

export const dynamic = "force-dynamic";

export default async function Sub2ApiStatusPage() {
  await requireAdmin();
  return (
    <div className="container data-container">
      <PageHead
        title="Sub2API 状态"
        sub="只读查看账号健康、容量和今日用量。"
        actions={<Link className="btn" href="/settings?tab=sub2api">连接设置</Link>}
      />
      <Sub2ApiStatusView />
    </div>
  );
}

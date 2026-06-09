import { PageHead } from "@/components/page-head";
import { ModelsTable } from "@/components/models/models-table";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  await requireAdmin();
  return (
    <div className="container data-container">
      <PageHead
        title="模型"
        sub={
          <>
            <span>名称</span>
            <span className="sep">/</span>
            <span>展示与启用</span>
            <span className="sep">/</span>
            <span>映射模型独立配置</span>
          </>
        }
      />
      <ModelsTable />
    </div>
  );
}

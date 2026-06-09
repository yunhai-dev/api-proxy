import { PageHead } from "@/components/page-head";
import { MappingsTable } from "@/components/mappings/mappings-table";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MappingsPage() {
  await requireAdmin();
  return (
    <div className="container data-container">
      <PageHead
        title="模型映射"
        sub={
          <>
            <span>入站模型</span>
            <span className="sep">/</span>
            <span>上游模型</span>
          </>
        }
      />
      <MappingsTable />
    </div>
  );
}

import { PageHead } from "@/components/page-head";
import { PricingTable } from "@/components/pricing/pricing-table";
import { requireAdmin } from "@/lib/auth";

export default async function PricingPage() {
  await requireAdmin();
  return (
    <div className="container data-container">
      <PageHead
        title="模型定价"
        sub={
          <>
            <span>渠道价格</span>
            <span className="sep">/</span>
            <span>默认模型价格</span>
          </>
        }
      />
      <PricingTable />
    </div>
  );
}

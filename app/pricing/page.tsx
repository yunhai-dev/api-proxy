import { PricingTable } from "@/components/pricing/pricing-table";
import { requireAdmin } from "@/lib/auth";

export default async function PricingPage() {
  await requireAdmin();
  return (
    <section>
      <div className="section-title">
        <h1>模型定价</h1>
        <p>按渠道和模型配置输入/输出 Token 单价，未选择渠道时作为该服务商模型默认价。</p>
      </div>
      <PricingTable />
    </section>
  );
}

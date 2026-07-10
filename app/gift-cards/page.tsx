import { PageHead } from "@/components/page-head";
import { AdminGiftCards } from "@/components/gift-cards/admin-gift-cards";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function GiftCardsPage() {
  await requireAdmin();
  return (
    <div className="container data-container">
      <PageHead
        title="礼品卡"
        sub={
          <>
            <span>一次性卡密</span>
            <span className="sep">/</span>
            <span>账户额度充值</span>
          </>
        }
      />
      <AdminGiftCards />
    </div>
  );
}

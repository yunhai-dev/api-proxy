import { PageHead } from "@/components/page-head";
import { SettingsForm } from "@/components/settings/settings-form";
import { requireAdmin } from "@/lib/auth";

export default async function SettingsPage() {
  await requireAdmin();
  return (
    <div className="container data-container">
      <PageHead
        title="系统设置"
        sub={
          <>
            <span>站点配置</span>
            <span className="sep">/</span>
            <span>运行策略</span>
          </>
        }
      />
      <SettingsForm />
    </div>
  );
}

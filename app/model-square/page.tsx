import Link from "next/link";
import { LandingNav } from "@/components/landing-nav";
import { ModelSquareList } from "@/components/models/model-square-list";
import { publicModelsAsync } from "@/lib/model-catalog";
import { getSettingsAsync } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function ModelSquarePage() {
  const [models, settings] = await Promise.all([publicModelsAsync(), getSettingsAsync()]);
  const claude = models.filter(model => model.provider === "claude");
  const openai = models.filter(model => model.provider === "openai");

  return (
    <div className="landing-page model-square-page">
      <LandingNav />

      <main className="model-square-shell">
        <section className="model-square-hero">
          <span className="landing-kicker mono">model square</span>
          <h1>{settings.siteName} 模型广场</h1>
          <p>这里展示当前开放接入的模型。列表由后台模型管理控制，仅展示已启用且设置为前台可见的模型。</p>
          <div className="model-square-stats mono" aria-label="模型统计">
            <span>{models.length} models</span>
            <span>{claude.length} claude</span>
            <span>{openai.length} openai</span>
          </div>
        </section>

        {models.length === 0 ? (
          <section className="model-square-empty">
            <span className="landing-kicker mono">empty catalog</span>
            <h2>暂未开放展示模型。</h2>
            <p>管理员可以在后台「模型」页面启用模型，并打开展示开关后，这里会自动出现。</p>
            <Link className="btn" href="/docs">查看接入文档</Link>
          </section>
        ) : (
          <section className="model-square-group">
            <div className="model-square-group-head">
              <div>
                <span className="landing-kicker mono">available models</span>
                <h2>可用模型</h2>
              </div>
              <span className="model-square-count">{models.length} 个模型</span>
            </div>
            <ModelSquareList models={models} />
          </section>
        )}
      </main>
    </div>
  );
}

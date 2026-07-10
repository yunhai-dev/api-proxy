import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { LandingNav } from "@/components/landing-nav";
import { getSettingsAsync } from "@/lib/settings";

export const dynamic = "force-dynamic";

const FEATURED_MODELS = [
  { provider: "claude", name: "Claude Opus", tag: "复杂推理", description: "适合长文分析、代码审查和高价值任务。" },
  { provider: "claude", name: "Claude Sonnet", tag: "均衡输出", description: "在速度、质量和成本之间取得稳定平衡。" },
  { provider: "claude", name: "Claude Haiku", tag: "快速响应", description: "适合高频短请求、分类和轻量 Agent。" },
  { provider: "openai", name: "GPT-5", tag: "通用旗舰", description: "覆盖对话、工具调用、结构化输出等场景。" },
  { provider: "openai", name: "GPT-5 Mini", tag: "性价比", description: "适合批量任务、后台处理和低延迟体验。" },
  { provider: "openai", name: "GPT-4.1", tag: "代码增强", description: "面向编程、数据处理和兼容 OpenAI 生态。" },
] as const;

const CAPABILITIES = [
  { title: "统一入口", text: "一个 Base URL 承接 Claude 与 OpenAI 风格请求，前端、服务端和工具链都能复用。" },
  { title: "多渠道路由", text: "按模型、服务商、权重和健康状态选择上游，异常时自动降级到可用渠道。" },
  { title: "密钥与额度", text: "为用户或团队分发独立 API Key，限制 RPM、TPM、并发和可用余额。" },
  { title: "实时日志", text: "记录请求、延迟、Token、成本和错误详情，方便排障和用量复盘。" },
  { title: "模型与定价", text: "统一维护模型目录、映射关系和计费价格，减少每个项目重复配置。" },
  { title: "运营控制", text: "公告、维护模式、邮件配置、礼品卡和配置导入导出都在控制台集中管理。" },
] as const;

const STEPS = [
  { title: "创建账号与密钥", text: "注册后生成 sk-relay 开头的访问密钥，团队管理员可以分配额度和角色。" },
  { title: "替换 Base URL", text: "保留熟悉的 OpenAI / Claude 调用方式，只把 endpoint 指向你的网关。" },
  { title: "观察用量与稳定性", text: "在控制台查看日志、成本、模型分布和渠道健康，逐步把调用接入生产。" },
] as const;

const USE_CASES = [
  "产品内置 AI 对话与客服助手",
  "Claude Code / Codex 等开发工具统一出口",
  "Agent 工作流、多模型 fallback 与批处理",
  "团队额度管理、成本核算与审计追踪",
] as const;

const FAQS = [
  { question: "需要改很多业务代码吗？", answer: "通常只需要替换 Base URL 和 API Key。OpenAI 风格接口可以继续调用 /v1/chat/completions，Claude 风格接口可以继续调用 /v1/messages。" },
  { question: "首页模型卡片是实时列表吗？", answer: "不是。这里是常见模型入口预览，完整可用模型和价格请进入模型广场查看。" },
  { question: "管理员能控制用户用量吗？", answer: "可以。控制台支持用户角色、API Key、额度、RPM、TPM、最大并发和余额管理。" },
  { question: "上游渠道异常时怎么办？", answer: "网关会根据渠道健康、模型映射和权重选择候选渠道，并在可 fallback 的错误上切换到其他可用渠道。" },
] as const;

function providerLabel(provider: "claude" | "openai") {
  return provider === "claude" ? "Claude" : "OpenAI";
}

export default async function Home() {
  const [user, settings] = await Promise.all([getCurrentUser(), getSettingsAsync()]);
  const primaryHref = user ? "/dashboard" : "/register";
  const primaryLabel = user ? "进入控制台" : "申请接入";

  return (
    <div className="landing-page">
      <LandingNav />

      <section className="landing-hero landing-hero-v2">
        <div className="landing-hero-copy">
          <span className="landing-kicker mono">{settings.siteName} · Claude / OpenAI gateway</span>
          <h1>一个入口，调用 Claude 与 OpenAI 主流模型。</h1>
          <p>
            面向产品、开发者与团队的模型访问网关。统一 Base URL、统一密钥管理、统一日志与计费，让 Claude 与 OpenAI 在你的产品里像同一个服务一样工作。
          </p>
          <div className="landing-hero-actions">
            <Link className="btn primary" href={primaryHref}>{primaryLabel}</Link>
            <Link className="btn" href="/model-square">浏览模型广场</Link>
            <Link className="btn" href="/docs">查看 API 文档</Link>
          </div>
        </div>
        <div className="landing-hero-card" aria-label="网关控制台示意">
          <div className="landing-card-head">
            <span className="dot live" />
            <span className="mono">gateway · live</span>
            <span className="landing-card-status mono">all systems normal</span>
          </div>
          <ul className="landing-card-stats mono">
            <li><span className="dim">endpoint</span><strong>https://{settings.siteName}.example.com/v1</strong></li>
            <li><span className="dim">providers</span><strong>Claude · OpenAI</strong></li>
            <li><span className="dim">routing</span><strong>weighted · health-aware</strong></li>
            <li><span className="dim">p50 latency</span><strong>842 ms</strong></li>
            <li><span className="dim">streaming</span><strong>SSE · ndjson</strong></li>
          </ul>
          <div className="landing-card-foot mono">
            <span><span className="dot ok" />Claude</span>
            <span><span className="dot ok" />OpenAI</span>
            <span><span className="dot live" />Realtime</span>
          </div>
        </div>
      </section>

      <section className="landing-metric-strip" aria-label="核心卖点">
        <div className="landing-metric"><span className="dim mono">providers</span><strong>Claude + OpenAI</strong></div>
        <div className="landing-metric"><span className="dim mono">integrations</span><strong>OpenAI / Claude 兼容接口</strong></div>
        <div className="landing-metric"><span className="dim mono">observability</span><strong>实时日志 · 用量统计</strong></div>
        <div className="landing-metric"><span className="dim mono">controls</span><strong>配额 · 路由 · 公告</strong></div>
      </section>

      <section id="features" className="landing-section">
        <div className="landing-section-head">
          <span className="landing-kicker mono">capabilities</span>
          <h2>把模型访问做成团队基础设施。</h2>
          <p>不只是代理，而是围绕密钥、路由、限流、日志和计费构建的网关层。</p>
        </div>
        <div className="landing-capability-grid">
          {CAPABILITIES.map(item => (
            <article key={item.title} className="landing-capability-card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="models" className="landing-section">
        <div className="landing-section-head">
          <span className="landing-kicker mono">model preview</span>
          <h2>常见模型入口预览</h2>
          <p>这里是常用模型的快速预览，完整模型和定价请进入模型广场查看。</p>
        </div>
        <div className="landing-model-grid">
          {FEATURED_MODELS.map(model => (
            <Link key={model.name} href="/model-square" className={`landing-model-card ${model.provider}`}>
              <div className="landing-model-card-head">
                <span className={`type-pill ${model.provider}`}>{providerLabel(model.provider)}</span>
                <span className="landing-model-tag mono">{model.tag}</span>
              </div>
              <h3>{model.name}</h3>
              <p>{model.description}</p>
              <div className="landing-model-card-foot">
                <span className="mono">查看模型广场</span>
                <span aria-hidden="true">→</span>
              </div>
            </Link>
          ))}
        </div>
        <div className="landing-section-foot">
          <Link className="btn" href="/model-square">查看完整模型 →</Link>
        </div>
      </section>

      <section id="integration" className="landing-section">
        <div className="landing-section-head">
          <span className="landing-kicker mono">integration</span>
          <h2>三步完成接入</h2>
          <p>从账号创建到生产调用，沿用你熟悉的接口风格，几乎没有迁移成本。</p>
        </div>
        <ol className="landing-steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="landing-step">
              <span className="landing-step-index mono">step {String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="use-cases" className="landing-section">
        <div className="landing-section-head">
          <span className="landing-kicker mono">use cases</span>
          <h2>在不同场景里都能落地</h2>
        </div>
        <ul className="landing-use-cases">
          {USE_CASES.map(item => (
            <li key={item} className="landing-use-case mono">{item}</li>
          ))}
        </ul>
      </section>

      <section className="landing-section landing-snippet-section">
        <div className="landing-section-head">
          <span className="landing-kicker mono">request sample</span>
          <h2>继续用熟悉的 OpenAI / Claude 风格</h2>
          <p>保持团队原有调用方式，只需替换 endpoint 和 API Key。</p>
        </div>
        <div className="landing-snippet-grid">
          <div className="landing-code-block mono">
            <div className="landing-code-head mono"><span>POST</span> /v1/chat/completions</div>
            <pre>{`curl https://your-domain.example/v1/chat/completions \\
  -H "Authorization: Bearer sk-relay-..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5-mini",
    "messages": [{ "role": "user", "content": "Hi" }]
  }'`}</pre>
          </div>
          <div className="landing-code-block mono">
            <div className="landing-code-head mono"><span>POST</span> /v1/messages</div>
            <pre>{`curl https://your-domain.example/v1/messages \\
  -H "x-api-key: sk-relay-..." \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 512,
    "messages": [{ "role": "user", "content": "Hello" }]
  }'`}</pre>
          </div>
        </div>
      </section>

      <section id="faq" className="landing-section">
        <div className="landing-section-head">
          <span className="landing-kicker mono">faq</span>
          <h2>常见问题</h2>
        </div>
        <div className="landing-faq">
          {FAQS.map(item => (
            <details key={item.question} className="landing-faq-item">
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <div>
          <span className="landing-kicker mono">start building</span>
          <h2>把模型能力接进你的产品。</h2>
        </div>
        <Link className="btn primary" href={primaryHref}>{primaryLabel}</Link>
      </section>

      <footer className="landing-footer mono">
        <span>© {new Date().getFullYear()} {settings.siteName}</span>
        <Link href="/docs">文档</Link>
        <Link href="/model-square">模型广场</Link>
        <Link href="/login">登录</Link>
      </footer>
    </div>
  );
}

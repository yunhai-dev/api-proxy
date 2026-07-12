"use client";

import { useEffect, useState } from "react";
import { PageHead } from "@/components/page-head";

const API_KEY = "sk-relay-XXXX-xxxxxxxxxxxxxxxx";

type CodeTab = { key: string; label: string; lang: string; code: string };

function openaiTabs(baseUrl: string): CodeTab[] {
  return [
    { key: "curl", label: "命令行", lang: "bash", code: `curl -X POST ${baseUrl}/v1/chat/completions \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer ${API_KEY}" \\
  -d '{
    "model": "gpt-5-mini",
    "messages": [{ "role": "user", "content": "hello" }]
  }'` },
    { key: "js", label: "JavaScript", lang: "ts", code: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${API_KEY}",
  baseURL: "${baseUrl}/v1",
});

const res = await client.chat.completions.create({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "hello" }],
});` },
    { key: "py", label: "Python", lang: "python", code: `from openai import OpenAI

client = OpenAI(
    api_key="${API_KEY}",
    base_url="${baseUrl}/v1",
)

res = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "hello"}],
)

print(res.choices[0].message.content)` },
    { key: "stream", label: "流式", lang: "python", code: `from openai import OpenAI

client = OpenAI(
    api_key="${API_KEY}",
    base_url="${baseUrl}/v1",
)

stream = client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "hello stream"}],
    stream=True,
)

for event in stream:
    delta = event.choices[0].delta.content
    if delta:
        print(delta, end="", flush=True)` },
  ];
}

function claudeTabs(baseUrl: string): CodeTab[] {
  return [
    { key: "curl", label: "命令行", lang: "bash", code: `curl -X POST ${baseUrl}/v1/messages \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer ${API_KEY}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-haiku-4-5",
    "max_tokens": 512,
    "messages": [{ "role": "user", "content": "hello" }]
  }'` },
    { key: "js", label: "JavaScript", lang: "ts", code: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "${API_KEY}",
  baseURL: "${baseUrl}",
});

const res = await client.messages.create({
  model: "claude-haiku-4-5",
  max_tokens: 512,
  messages: [{ role: "user", content: "hello" }],
});` },
    { key: "py", label: "Python", lang: "python", code: `from anthropic import Anthropic

client = Anthropic(
    api_key="${API_KEY}",
    base_url="${baseUrl}",
)

res = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=512,
    messages=[{"role": "user", "content": "hello"}],
)

print(res.content[0].text)` },
    { key: "stream", label: "流式", lang: "python", code: `from anthropic import Anthropic

client = Anthropic(
    api_key="${API_KEY}",
    base_url="${baseUrl}",
)

with client.messages.stream(
    model="claude-haiku-4-5",
    max_tokens=512,
    messages=[{"role": "user", "content": "hello stream"}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)` },
  ];
}

export default function DocsContent() {
  return <DocsBody />;
}

function DocsBody() {
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  return (
    <div className="container docs">
      <PageHead
        title="对接文档"
        sub={
          <>
            <span>OpenAI / Claude 兼容入口</span>
            <span className="sep">/</span>
            <span>统一鉴权、渠道路由、日志统计</span>
          </>
        }
      />

      <section className="docs-section">
        <h2>基础信息</h2>
        <table className="table docs-table">
          <tbody>
            <tr><td>Base URL</td><td className="mono">{baseUrl || "正在读取浏览器地址"}</td></tr>
            <tr><td>鉴权方式</td><td className="mono">Authorization: Bearer {API_KEY}</td></tr>
            <tr><td>OpenAI 入口</td><td className="mono">POST /v1/chat/completions</td></tr>
            <tr><td>Embedding 入口</td><td className="mono">POST /v1/embeddings</td></tr>
            <tr><td>Claude 入口</td><td className="mono">POST /v1/messages</td></tr>
            <tr><td>模型列表</td><td className="mono">GET /v1/models</td></tr>
            <tr><td>用量查询</td><td className="mono">GET /api/v1/usage/:key?range=24h|7d|30d</td></tr>
          </tbody>
        </table>
      </section>

      <section className="docs-section">
        <h2>OpenAI 接口示例</h2>
        <p>将客户端的基础地址指向本站的 <span className="mono">/v1</span>，并使用本站生成的 API 密钥。</p>
        <CodeTabs tabs={openaiTabs(baseUrl)} />
        <h3>Embedding</h3>
        <Code lang="bash">{`curl -X POST ${baseUrl}/v1/embeddings \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer ${API_KEY}" \\
  -d '{
    "model": "text-embedding-3-small",
    "input": "hello"
  }'`}</Code>
      </section>

      <section className="docs-section">
        <h2>Claude 接口示例</h2>
        <p>Claude 兼容入口使用 Messages 格式。请求会根据模型和渠道类型路由到 Claude 上游。</p>
        <CodeTabs tabs={claudeTabs(baseUrl)} />
      </section>

      <section className="docs-section">
        <h2>模型与渠道路由</h2>
        <ul>
          <li>OpenAI 接口只会选择 <span className="mono">type=openai</span> 的渠道。</li>
          <li>Claude 接口只会选择 <span className="mono">type=claude</span> 的渠道。</li>
          <li>渠道的模型列表为空或包含 <span className="mono">*</span> 时，视为支持全部模型。</li>
          <li>多个可用渠道同时匹配时，按渠道权重选择；429、5xx、网络错误会自动切换备用渠道。</li>
        </ul>
      </section>

      <section className="docs-section">
        <h2>获取模型列表</h2>
        <p>对外模型列表使用标准兼容接口 <span className="mono">GET /v1/models</span>。OpenAI 请求只查询 OpenAI 渠道；Claude 请求只查询 Claude 渠道，两个模型商不会混在一起。API Key 允许全部渠道时，按请求头推断模型商；也可以用 <span className="mono">provider=claude|openai</span> 显式指定。</p>
        <h3>OpenAI 格式</h3>
        <Code lang="bash">{`curl "${baseUrl}/v1/models?provider=openai&format=openai" \
  -H "authorization: Bearer ${API_KEY}"`}</Code>
        <p>返回示例：</p>
        <Code lang="json">{`{
  "object": "list",
  "data": [
    {
      "id": "gpt-5-mini",
      "object": "model",
      "created": 1780000000,
      "owned_by": "api-proxy"
    }
  ]
}`}</Code>
        <h3>Claude 模型来源</h3>
        <Code lang="bash">{`curl "${baseUrl}/v1/models?provider=claude&format=claude" \
  -H "x-api-key: ${API_KEY}" \
  -H "anthropic-version: 2023-06-01"`}</Code>
        <p>返回示例：</p>
        <Code lang="json">{`{
  "data": [
    {
      "id": "claude-haiku-4-5",
      "type": "model",
      "display_name": "claude-haiku-4-5",
      "created_at": "1970-01-01T00:00:00Z"
    }
  ],
  "object": "list"
}`}</Code>
      </section>

      <section className="docs-section">
        <h2>用量查询</h2>
        <Code lang="bash">{`curl "${baseUrl}/api/v1/usage/${API_KEY}?range=24h"`}</Code>
        <p>返回请求数、输入/输出 Token、缓存 Token、成功/失败数量，以及按模型拆分的消耗。</p>
      </section>
    </div>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlight(code: string, lang: string) {
  let html = escapeHtml(code);
  html = html.replace(/(&quot;.*?&quot;|'[^']*')/g, '<span class="tok-str">$1</span>');
  html = html.replace(/\b(import|from|const|await|new|return|curl|POST|GET|with|for|in|as|if|print)\b/g, '<span class="tok-kw">$1</span>');
  if (lang === "bash") {
    html = html.replace(/(\s)(-[A-Za-z]|--[a-zA-Z0-9-]+)/g, '$1<span class="tok-flag">$2</span>');
  }
  html = html.replace(/\b(true|false|null|True|False|None)\b/g, '<span class="tok-lit">$1</span>');
  return html;
}

function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");
  const tab = tabs.find(t => t.key === active) ?? tabs[0];
  return (
    <div className="docs-tabs">
      <div className="docs-tabbar">
        {tabs.map(t => (
          <button
            key={t.key}
            className={t.key === tab.key ? "active" : ""}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Code lang={tab.lang}>{tab.code}</Code>
    </div>
  );
}

function Code({ children, lang = "text" }: { children: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard?.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }
  return (
    <div className="docs-code-wrap">
      <div className="docs-code-head">
        <span className="mono">{lang}</span>
        <button className="btn sm ghost" onClick={copy}>{copied ? "已复制" : "复制"}</button>
      </div>
      <pre className="docs-code"><code dangerouslySetInnerHTML={{ __html: highlight(children, lang) }} /></pre>
    </div>
  );
}

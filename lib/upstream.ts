/**
 * 上游 HTTP 客户端
 * - Anthropic / OpenAI 两种格式适配
 * - 支持 stream（SSE）与非 stream
 * - 支持超时与 abort
 */

export type Provider = "claude" | "openai";

export type UpstreamOptions = {
  channelType: Provider;
  openAiEndpoint?: "chat_completions" | "responses" | "embeddings";
  baseUrl: string;        // 不带尾斜杠
  upstreamKey: string;    // 上游 API 密钥
  model: string;          // 上游模型名
  body: string;           // 已序列化的 JSON body
  stream: boolean;
  signal?: AbortSignal;
  incomingHeaders?: Headers;
  timeoutMs?: number;
};

export type UpstreamOk = {
  ok: true;
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array>;
  contentType: string;
};

export type UpstreamErr = {
  ok: false;
  status: number;          // 0 = 网络错误
  errorMsg: string;
};

export type UpstreamResult = UpstreamOk | UpstreamErr;

const DEFAULT_TIMEOUT = 60_000;

export function apiUrl(baseUrl: string, endpoint: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const version = /\/v\d+$/.test(base) ? "" : "/v1";
  return `${base}${version}/${endpoint.replace(/^\/+/, "")}`;
}

export function endpointFor(provider: Provider, baseUrl: string, openAiEndpoint: UpstreamOptions["openAiEndpoint"] = "chat_completions"): string {
  if (provider === "claude") return apiUrl(baseUrl, "messages");
  if (openAiEndpoint === "responses") return apiUrl(baseUrl, "responses");
  if (openAiEndpoint === "embeddings") return apiUrl(baseUrl, "embeddings");
  return apiUrl(baseUrl, "chat/completions");
}

export function modelsEndpointFor(baseUrl: string): string {
  return apiUrl(baseUrl, "models");
}

export function headersFor(provider: Provider, upstreamKey: string, incoming?: Headers): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  if (provider === "claude") {
    headers.set("x-api-key", upstreamKey);
    headers.set("anthropic-version", incoming?.get("anthropic-version") || "2023-06-01");
    const beta = incoming?.get("anthropic-beta");
    if (beta) headers.set("anthropic-beta", beta);
  } else {
    headers.set("authorization", `Bearer ${upstreamKey}`);
    for (const name of ["idempotency-key", "openai-organization", "openai-project"]) {
      const value = incoming?.get(name);
      if (value) headers.set(name, value);
    }
  }
  return headers;
}

/**
 * 调用上游。返回 ok=true 时 body 是可读流，由调用方负责读完。
 */
export async function callUpstream(opts: UpstreamOptions): Promise<UpstreamResult> {
  const url = endpointFor(opts.channelType, opts.baseUrl, opts.openAiEndpoint);
  const headers = headersFor(opts.channelType, opts.upstreamKey, opts.incomingHeaders);

  const controller = new AbortController();
  let timedOut = false;
  const abortUpstream = () => {
    try { controller.abort(); } catch { /* already aborted */ }
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    abortUpstream();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT);
  if (opts.signal) {
    opts.signal.addEventListener("abort", abortUpstream, { once: true });
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: opts.body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryAfter = res.headers.get("retry-after");
      const suffix = retryAfter ? ` (retry-after: ${retryAfter})` : "";
      return { ok: false, status: res.status, errorMsg: `${text.slice(0, 200) || `HTTP ${res.status}`}${suffix}` };
    }
    if (!res.body) return { ok: false, status: res.status, errorMsg: "empty body" };
    return {
      ok: true,
      status: res.status,
      headers: res.headers,
      body: res.body,
      contentType: res.headers.get("content-type") ?? "application/json",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("abort") || msg.includes("AbortError")) {
      return { ok: false, status: 0, errorMsg: timedOut ? "timeout" : "client aborted" };
    }
    return { ok: false, status: 0, errorMsg: `network: ${msg.slice(0, 100)}` };
  } finally {
    clearTimeout(timeout);
    if (opts.signal) opts.signal.removeEventListener("abort", abortUpstream);
  }
}

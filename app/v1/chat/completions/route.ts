import { NextRequest } from "next/server";
import { proxyErrorSource, proxyOnce } from "@/lib/proxy";
import { normalizeOpenAiRequestBody } from "@/lib/openai-responses-lite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authFromHeaders(headers: Headers) {
  return headers.get("authorization")
    ?? headers.get("x-api-key")
    ?? headers.get("api-key");
}

/**
 * OpenAI 兼容入站
 * POST /v1/chat/completions
 * Authorization: Bearer sk-relay-XXXX
 */
export async function POST(req: NextRequest) {
  const body = normalizeOpenAiRequestBody(await req.text(), "chat_completions");
  const stream = (() => {
    const a = req.headers.get("accept") ?? "";
    if (a.includes("text/event-stream")) return true;
    try { return !!JSON.parse(body).stream; } catch { return false; }
  })();

  const result = await proxyOnce({
    type: "openai",
    body,
    stream,
    rawAuth: authFromHeaders(req.headers),
    signal: req.signal,
    incomingHeaders: req.headers,
  });

  if (result.kind === "success") return result.response;
  if (result.kind === "client_error") {
    return new Response(JSON.stringify({ request_id: result.requestId, error: { message: result.error, type: "invalid_request_error", source: "proxy", request_id: result.requestId } }), {
      status: result.status,
      headers: { "content-type": "application/json", "x-request-id": result.requestId, "x-proxy-error-source": "proxy" },
    });
  }
  const errorSource = proxyErrorSource(result);
  const errorType = errorSource === "proxy" ? "invalid_request_error" : "api_error";
  return new Response(JSON.stringify({
    request_id: result.requestId,
    error: { message: result.error, type: errorType, source: errorSource, request_id: result.requestId },
  }), {
    status: result.status,
    headers: { "content-type": "application/json", "x-request-id": result.requestId, "x-proxy-error-source": errorSource },
  });
}

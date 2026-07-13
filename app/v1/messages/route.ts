import { NextRequest } from "next/server";
import { proxyErrorSource, proxyOnce } from "@/lib/proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authFromHeaders(headers: Headers) {
  return headers.get("authorization")
    ?? headers.get("x-api-key")
    ?? headers.get("api-key");
}

/**
 * Anthropic 兼容入站
 * POST /v1/messages
 * Authorization: Bearer sk-relay-XXXX
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const stream = (() => {
    const a = req.headers.get("accept") ?? "";
    if (a.includes("text/event-stream")) return true;
    try { return !!JSON.parse(body).stream; } catch { return false; }
  })();

  const result = await proxyOnce({
    type: "claude",
    body,
    stream,
    rawAuth: authFromHeaders(req.headers),
    signal: req.signal,
    incomingHeaders: req.headers,
  });

  if (result.kind === "success") return result.response;
  if (result.kind === "client_error") {
    return new Response(JSON.stringify({ type: "error", request_id: result.requestId, error: { type: "invalid_request_error", message: result.error, source: "proxy" } }), {
      status: result.status,
      headers: { "content-type": "application/json", "x-request-id": result.requestId, "x-proxy-error-source": "proxy" },
    });
  }
  // upstream_error
  const errorSource = proxyErrorSource(result);
  const errorType = errorSource === "proxy" ? "invalid_request_error" : "api_error";
  return new Response(JSON.stringify({
    type: "error",
    request_id: result.requestId,
    error: { type: errorType, message: result.error, source: errorSource },
  }), {
    status: result.status,
    headers: { "content-type": "application/json", "x-request-id": result.requestId, "x-proxy-error-source": errorSource },
  });
}

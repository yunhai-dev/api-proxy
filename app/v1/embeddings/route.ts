import { NextRequest } from "next/server";
import { proxyOnce } from "@/lib/proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authFromHeaders(headers: Headers) {
  return headers.get("authorization")
    ?? headers.get("x-api-key")
    ?? headers.get("api-key");
}

/**
 * OpenAI Embeddings 兼容入站
 * POST /v1/embeddings
 * Authorization: Bearer sk-relay-XXXX
 */
export async function POST(req: NextRequest) {
  const result = await proxyOnce({
    type: "openai",
    openAiEndpoint: "embeddings",
    body: await req.text(),
    stream: false,
    rawAuth: authFromHeaders(req.headers),
    signal: req.signal,
    incomingHeaders: req.headers,
  });

  if (result.kind === "success") return result.response;
  if (result.kind === "client_error") {
    return new Response(JSON.stringify({ request_id: result.requestId, error: { message: result.error, type: "invalid_request_error", request_id: result.requestId } }), {
      status: result.status,
      headers: { "content-type": "application/json", "x-request-id": result.requestId },
    });
  }
  return new Response(JSON.stringify({
    request_id: result.requestId,
    error: { message: result.error, type: "api_error", request_id: result.requestId },
  }), {
    status: result.status,
    headers: { "content-type": "application/json", "x-request-id": result.requestId },
  });
}

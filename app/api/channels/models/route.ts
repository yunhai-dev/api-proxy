import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { usePostgres } from "@/lib/db/runtime";
import { modelsEndpointFor, validateUpstreamBaseUrl } from "@/lib/upstream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Provider = "claude" | "openai";

function modelHeaders(type: Provider, apiKey: string): HeadersInit {
  if (type === "claude") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return { authorization: `Bearer ${apiKey}` };
}

function extractModels(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as { data?: unknown; models?: unknown };
  const list = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : [];
  return [...new Set(list
    .map(item => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "id" in item) {
        const id = (item as { id?: unknown }).id;
        return typeof id === "string" ? id : null;
      }
      return null;
    })
    .filter((x): x is string => !!x)
    .sort())];
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  let type = body.type as Provider | undefined;
  let baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  let apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";

  if (typeof body.id === "string" && body.id) {
    const channel = usePostgres()
      ? await (async () => {
        const { pgDb, pgSchema } = await import("@/lib/db/pg");
        return (await pgDb.select().from(pgSchema.channels).where(eq(pgSchema.channels.id, body.id)).limit(1))[0];
      })()
      : db.select().from(schema.channels).where(eq(schema.channels.id, body.id)).get();
    if (!channel) return NextResponse.json({ error: "未找到渠道" }, { status: 404 });
    type = type ?? channel.type as Provider;
    baseUrl = baseUrl || channel.baseUrl;
    apiKey = apiKey || channel.apiKey;
  }

  if (type !== "claude" && type !== "openai") {
    return NextResponse.json({ error: "请选择服务商" }, { status: 400 });
  }
  const baseUrlError = validateUpstreamBaseUrl(baseUrl);
  if (baseUrlError) return NextResponse.json({ error: baseUrlError }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: "请输入 API 密钥" }, { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(modelsEndpointFor(baseUrl), {
      method: "GET",
      headers: modelHeaders(type, apiKey),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ error: "获取模型列表失败，请检查渠道配置后重试" }, { status: res.status });
    }
    const data = JSON.parse(text);
    const models = extractModels(data);
    return NextResponse.json({ models });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg.includes("abort") ? "请求超时" : "获取模型列表失败，请检查渠道配置后重试" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

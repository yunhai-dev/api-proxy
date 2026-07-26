/**
 * 异步日志队列：代理主路径不等待 DB IO，日志在后台 drain 中写入。
 *
 * 设计原则：
 * - 代理路径只调用 enqueueRecord / enqueueUpdate，立即返回占位 LogEntry（id=0）
 * - 后台 drain 批量执行真实 DB 写入，失败静默
 * - 崩溃时队列内未写入的日志会丢失（已知可接受行为）
 * - SSE 广播（emit/publish）在入队时同步执行，不受 drain 影响
 */

import type { LogEntry } from "./types";

// 使用宽松类型避免与 log-generator 循环依赖
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LogInput = Record<string, any>;

export type LogJob =
  | { type: "record"; input: LogInput; resolve: (id: number) => void }
  | { type: "update"; id: number; input: LogInput };

const queue: LogJob[] = [];
let draining = false;
let drainFn: ((jobs: LogJob[]) => Promise<void>) | null = null;

/** 由 LogHub 在初始化时注入真实的 drain 函数，避免循环依赖 */
export function registerDrainFn(fn: (jobs: LogJob[]) => Promise<void>) {
  drainFn = fn;
}

/**
 * 入队一条新日志记录。
 * 返回 Promise<number> —— 解析为实际写入后的 logId（drain 完成前一直挂起）。
 */
export function enqueueRecord(input: LogInput): Promise<number> {
  return new Promise<number>(resolve => {
    queue.push({ type: "record", input, resolve });
    kickDrain();
  });
}

/** 入队一条更新，不需要返回值。*/
export function enqueueUpdate(id: number, input: LogInput): void {
  queue.push({ type: "update", id, input });
  kickDrain();
}

function kickDrain() {
  if (draining || !drainFn) return;
  draining = true;
  void runDrain().finally(() => { draining = false; });
}

async function runDrain() {
  while (queue.length > 0) {
    const batch = queue.splice(0, 100);
    if (drainFn) {
      await drainFn(batch).catch(() => {
        for (const job of batch) {
          if (job.type === "record") job.resolve(0);
        }
      });
    }
  }
}

/** 占位 LogEntry，drain 完成前的临时值 */
export function placeholderEntry(input: LogInput): LogEntry {
  const ts = (input.ts as number | undefined) || Date.now();
  return {
    id: (input.id as number | undefined) ?? 0,
    requestId: (input.requestId as string) ?? "",
    ts,
    keyId: (input.keyId as string) ?? "",
    keyName: (input.keyName as string | undefined) ?? "",
    keyPrefix: (input.keyPrefix as string | undefined) ?? "—",
    channelId: (input.channelId as string) ?? "",
    channelName: (input.channelName as string | undefined) ?? "",
    channelType: ((input.channelType as string | undefined) ?? "claude") as "claude" | "openai",
    model: (input.model as string) ?? "—",
    inboundModel: (input.inboundModel as string | undefined) || (input.model as string) || "—",
    upstreamModel: (input.upstreamModel as string | undefined) || (input.model as string) || "—",
    mappingId: (input.mappingId as string | undefined) || "",
    mappedChannelIds: (input.mappedChannelIds as string[] | undefined) ?? [],
    status: (input.status as number) ?? 0,
    latencyMs: (input.latencyMs as number) ?? 0,
    ttftMs: (input.ttftMs as number | undefined) ?? (input.latencyMs as number | undefined) ?? 0,
    durationMs: (input.durationMs as number | undefined) ?? (input.latencyMs as number | undefined) ?? 0,
    tokensIn: (input.tokensIn as number) ?? 0,
    tokensOut: (input.tokensOut as number) ?? 0,
    cacheTokens: (input.cacheTokens as number | undefined) ?? 0,
    cacheReadTokens: (input.cacheReadTokens as number | undefined) ?? 0,
    cacheCreationTokens: (input.cacheCreationTokens as number | undefined) ?? 0,
    requestDetail: (input.requestDetail as string | null | undefined) ?? null,
    errorMsg: (input.errorMsg as string | null | undefined) ?? null,
    cost: (input.cost as number | undefined) ?? 0,
  };
}

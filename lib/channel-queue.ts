import { acquireRedisSemaphore, isRedisSemaphoreSaturated } from "@/lib/redis-semaphore";

type Waiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
};

type QueueState = {
  active: number;
  waiters: Waiter[];
};

declare global {
  // eslint-disable-next-line no-var
  var __channelQueues: Map<string, QueueState> | undefined;
}

const queues = globalThis.__channelQueues ?? new Map<string, QueueState>();
globalThis.__channelQueues = queues;

export async function acquireChannelSlot(
  channelId: string,
  maxConcurrency: number,
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<() => void> {
  if (maxConcurrency <= 0) return () => {};
  const redisRelease = await acquireRedisSemaphore(`sem:channel:${channelId}`, maxConcurrency, { signal, timeoutMs });
  if (redisRelease) return () => { void redisRelease(); };
  if (signal?.aborted) throw new Error("channel queue wait aborted");

  const state = queues.get(channelId) ?? { active: 0, waiters: [] };
  queues.set(channelId, state);

  if (state.active < maxConcurrency) {
    state.active += 1;
    return releaseFor(channelId, state, maxConcurrency);
  }

  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      resolve: () => {
        signal?.removeEventListener("abort", onAbort);
        state.active += 1;
        resolve(releaseFor(channelId, state, maxConcurrency));
      },
      reject,
      signal,
    };
    const onAbort = () => {
      const index = state.waiters.indexOf(waiter);
      if (index >= 0) state.waiters.splice(index, 1);
      if (state.active === 0 && state.waiters.length === 0) queues.delete(channelId);
      reject(new Error("channel queue wait aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    state.waiters.push(waiter);
  });
}

export async function isChannelSaturated(channelId: string, maxConcurrency: number) {
  if (maxConcurrency <= 0) return false;
  const redisSaturated = await isRedisSemaphoreSaturated(`sem:channel:${channelId}`, maxConcurrency);
  if (redisSaturated) return true;
  const state = queues.get(channelId);
  return !!state && state.active >= maxConcurrency;
}

function releaseFor(channelId: string, state: QueueState, maxConcurrency: number) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
    while (state.active < maxConcurrency && state.waiters.length > 0) {
      const next = state.waiters.shift();
      if (next?.signal?.aborted) {
        next.reject(new Error("channel queue wait aborted"));
        continue;
      }
      next?.resolve();
    }
    if (state.active === 0 && state.waiters.length === 0) queues.delete(channelId);
  };
}

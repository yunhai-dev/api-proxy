import { acquireRedisSemaphore } from "@/lib/redis-semaphore";

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
  var __keyQueues: Map<string, QueueState> | undefined;
}

const queues = globalThis.__keyQueues ?? new Map<string, QueueState>();
globalThis.__keyQueues = queues;

export async function acquireKeySlot(
  keyId: string,
  maxConcurrency: number,
  signal?: AbortSignal,
): Promise<() => void> {
  if (maxConcurrency <= 0) return () => {};
  const redisRelease = await acquireRedisSemaphore(`sem:key:${keyId}`, maxConcurrency, { signal });
  if (redisRelease) return () => { void redisRelease(); };
  if (signal?.aborted) throw new Error("key queue wait aborted");
  const state = queues.get(keyId) ?? { active: 0, waiters: [] };
  queues.set(keyId, state);
  if (state.active < maxConcurrency) {
    state.active += 1;
    return releaseFor(keyId, state, maxConcurrency);
  }
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      resolve: () => {
        signal?.removeEventListener("abort", onAbort);
        state.active += 1;
        resolve(releaseFor(keyId, state, maxConcurrency));
      },
      reject,
      signal,
    };
    const onAbort = () => {
      const index = state.waiters.indexOf(waiter);
      if (index >= 0) state.waiters.splice(index, 1);
      if (state.active === 0 && state.waiters.length === 0) queues.delete(keyId);
      reject(new Error("key queue wait aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    state.waiters.push(waiter);
  });
}

function releaseFor(keyId: string, state: QueueState, maxConcurrency: number) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
    while (state.active < maxConcurrency && state.waiters.length > 0) {
      const next = state.waiters.shift();
      if (next?.signal?.aborted) {
        next.reject(new Error("key queue wait aborted"));
        continue;
      }
      next?.resolve();
    }
    if (state.active === 0 && state.waiters.length === 0) queues.delete(keyId);
  };
}

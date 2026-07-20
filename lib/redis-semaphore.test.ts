// @ts-expect-error Bun provides this module at test runtime.
import { expect, mock, test } from "bun:test";

const calls: { script: string; key: string }[] = [];
let releaseFailures = 0;
const redis = {
  eval: async (script: string, input: { keys: string[] }) => {
    calls.push({ script, key: input.keys[0]! });
    if (script.trim().startsWith("redis.call('ZREM'") && releaseFailures > 0) {
      releaseFailures -= 1;
      throw new Error("Redis unavailable");
    }
    return 1;
  },
};

mock.module("./redis", () => ({ getRedis: async () => redis }));

const { acquireRedisSemaphore } = await import("./redis-semaphore");

test("releases an acquired Redis semaphore lease once", async () => {
  calls.length = 0;
  releaseFailures = 0;
  const release = await acquireRedisSemaphore("sem:channel:channel-1", 1);

  await release!();
  await release!();

  expect(calls).toHaveLength(2);
  expect(calls[0]!.key).toBe("sem:channel:channel-1");
  expect(calls[1]!.script).toContain("ZREM");
});

test("retries a transient Redis semaphore release failure", async () => {
  calls.length = 0;
  releaseFailures = 1;
  const release = await acquireRedisSemaphore("sem:key:key-1", 1);

  await Promise.all([release!(), release!()]);

  expect(calls).toHaveLength(3);
  expect(calls.filter(call => call.script.trim().startsWith("redis.call('ZREM'"))).toHaveLength(2);
});

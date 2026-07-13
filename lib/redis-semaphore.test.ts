// @ts-expect-error Bun provides this module at test runtime.
import { expect, mock, test } from "bun:test";

const calls: { script: string; key: string }[] = [];
const redis = {
  eval: async (script: string, input: { keys: string[] }) => {
    calls.push({ script, key: input.keys[0]! });
    return calls.length === 1 ? 1 : 1;
  },
};

mock.module("./redis", () => ({ getRedis: async () => redis }));

const { acquireRedisSemaphore } = await import("./redis-semaphore");

test("releases an acquired Redis semaphore lease once", async () => {
  calls.length = 0;
  const release = await acquireRedisSemaphore("sem:channel:channel-1", 1);

  await release!();
  await release!();

  expect(calls).toHaveLength(2);
  expect(calls[0]!.key).toBe("sem:channel:channel-1");
  expect(calls[1]!.script).toContain("ZREM");
});

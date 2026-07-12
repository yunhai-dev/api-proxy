// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { acquireKeySlot } from "./key-queue";

describe("key queue cancellation", () => {
  test("removes an aborted waiter", async () => {
    const release = await acquireKeySlot("cancel-test", 1);
    const controller = new AbortController();
    const waiting = acquireKeySlot("cancel-test", 1, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow("aborted");
    release();
    const next = await acquireKeySlot("cancel-test", 1);
    next();
  });
});

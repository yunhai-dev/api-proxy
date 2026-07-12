// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { acquireChannelSlot } from "./channel-queue";

describe("channel queue cancellation", () => {
  test("removes an aborted waiter", async () => {
    const release = await acquireChannelSlot("cancel-test", 1);
    const controller = new AbortController();
    const waiting = acquireChannelSlot("cancel-test", 1, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow("aborted");
    release();
    const next = await acquireChannelSlot("cancel-test", 1);
    next();
  });
});

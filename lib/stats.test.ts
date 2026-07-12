// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { bridgeObservability } from "./stats";

const detail = (direction: string, compatibilityRejection?: string) => JSON.stringify({
  protocol: { direction },
  compatibility_rejection: compatibilityRejection ?? null,
});

describe("bridge observability", () => {
  test("separates observed directions from unclassified records", () => {
    const metrics = bridgeObservability([
      { requestDetail: detail("native"), status: 200, latencyMs: 30, ttftMs: 10, durationMs: 30 },
      { requestDetail: detail("openai_to_claude"), status: 200, latencyMs: 50, ttftMs: 20, durationMs: 50 },
      { requestDetail: detail("claude_to_openai", "unsupported field"), status: 400, latencyMs: 5, ttftMs: 5, durationMs: 5 },
      { requestDetail: null, status: 200, latencyMs: 1, ttftMs: 1, durationMs: 1 },
      { requestDetail: "invalid", status: 200, latencyMs: 1, ttftMs: 1, durationMs: 1 },
    ]);

    expect(metrics.observedRequests).toBe(3);
    expect(metrics.unclassifiedRequests).toBe(2);
    expect(metrics.native.requests).toBe(1);
    expect(metrics.openaiToClaude.successes).toBe(1);
    expect(metrics.openaiToClaude.ttftP50Ms).toBe(20);
    expect(metrics.claudeToOpenai.failures).toBe(1);
    expect(metrics.claudeToOpenai.compatibilityRejections).toBe(1);
  });

  test("does not classify unknown or missing audit records", () => {
    const metrics = bridgeObservability([
      { requestDetail: detail("unknown"), status: 200, latencyMs: 1, ttftMs: 1, durationMs: 1 },
    ], 3);

    expect(metrics.observedRequests).toBe(0);
    expect(metrics.unclassifiedRequests).toBe(3);
  });
});

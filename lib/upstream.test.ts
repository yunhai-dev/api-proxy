// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { headersFor } from "./upstream";

describe("upstream headers", () => {
  test("replaces credentials and forwards only allowlisted OpenAI headers", () => {
    const headers = headersFor("openai", "upstream-secret", new Headers({
      authorization: "Bearer client-secret",
      cookie: "session=secret",
      "idempotency-key": "request-1",
      "openai-project": "project-1",
      "x-arbitrary": "blocked",
    }));
    expect(headers.get("authorization")).toBe("Bearer upstream-secret");
    expect(headers.get("idempotency-key")).toBe("request-1");
    expect(headers.get("openai-project")).toBe("project-1");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-arbitrary")).toBeNull();
  });

  test("keeps Claude credentials server-side while allowing version controls", () => {
    const headers = headersFor("claude", "upstream-secret", new Headers({
      "x-api-key": "client-secret",
      "anthropic-version": "2026-01-01",
      "anthropic-beta": "feature-2026-01-01",
    }));
    expect(headers.get("x-api-key")).toBe("upstream-secret");
    expect(headers.get("anthropic-version")).toBe("2026-01-01");
    expect(headers.get("anthropic-beta")).toBe("feature-2026-01-01");
  });
});

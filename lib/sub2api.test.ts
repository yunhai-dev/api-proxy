// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { normalizeSub2ApiBaseUrl, parseSub2ApiAccountPage, parseSub2ApiPage, safeAccount, safeAccountDetail, Sub2ApiError } from "./sub2api";

describe("Sub2API boundary", () => {
  test("normalizes safe base URLs", () => {
    expect(normalizeSub2ApiBaseUrl("https://example.com/api/v1/")).toBe("https://example.com");
    expect(normalizeSub2ApiBaseUrl("http://sub2api:8080/")).toBe("http://sub2api:8080");
  });

  test("rejects unsafe base URLs and invalid pagination", () => {
    for (const value of ["ftp://example.com", "https://user:pass@example.com", "https://example.com?key=x", "nope"]) {
      expect(() => normalizeSub2ApiBaseUrl(value)).toThrow(Sub2ApiError);
    }
    expect(() => parseSub2ApiPage("0", "20")).toThrow("分页参数无效");
    expect(() => parseSub2ApiPage("1", "25")).toThrow("分页参数无效");
    expect(parseSub2ApiPage("2", "50")).toEqual({ page: 2, pageSize: 50 });
    expect(parseSub2ApiAccountPage({ items: [], total: 0, page: 0, page_size: 20, pages: 0 })).toEqual({ items: [], total: 0, page: 1, pageSize: 20, pages: 0 });
  });

  test("allowlists account fields", () => {
    const account = safeAccount({
      id: 1, name: "account", platform: "openai", type: "oauth", status: "active", schedulable: true,
      concurrency: 10, current_concurrency: 2, rate_limit_reset_at: Date.now() + 60_000,
      credentials: { access_token: "secret" }, credentials_status: "valid",
      extra: { cookie: "secret" }, proxy_id: 3, token: "secret", unknown: "secret",
      groups: [{ id: 2, name: "group", platform: "openai", api_keys: ["secret"], unknown: "secret" }],
    });
    expect(account).toMatchObject({ id: 1, name: "account", currentConcurrency: 2, rateLimited: true, groups: [{ id: 2, name: "group", platform: "openai" }] });
    const serialized = JSON.stringify(account);
    for (const field of ["credentials", "access_token", "credentials_status", "extra", "cookie", "proxy_id", "token", "unknown", "api_keys"]) {
      expect(serialized).not.toContain(field);
    }
    expect(serialized).not.toContain("secret");
  });

  test("parses 5h and 7d usage windows", () => {
    const detail = safeAccountDetail({ id: 1, groups: [] }, {
      five_hour: { utilization: 12.5, resets_at: "2026-07-22T18:00:00Z" },
      seven_day: { utilization: 34, resets_at: "2026-07-29T00:00:00Z" },
    });
    expect(detail.fiveHour).toEqual({ utilization: 12.5, resetsAt: "2026-07-22T18:00:00Z" });
    expect(detail.sevenDay).toEqual({ utilization: 34, resetsAt: "2026-07-29T00:00:00Z" });
  });
});

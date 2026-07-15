// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { normalizeSub2ApiBaseUrl, parseSub2ApiPage, safeAccount, Sub2ApiError } from "./sub2api";

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
  });

  test("allowlists account fields", () => {
    const account = safeAccount({
      id: 1, name: "account", platform: "openai", type: "oauth", status: "active", schedulable: true,
      concurrency: 10, current_concurrency: 2, credentials: { access_token: "secret" }, credentials_status: "valid",
      extra: { cookie: "secret" }, proxy_id: 3, token: "secret", unknown: "secret",
      groups: [{ id: 2, name: "group", platform: "openai", api_keys: ["secret"], unknown: "secret" }],
    });
    expect(account).toMatchObject({ id: 1, name: "account", currentConcurrency: 2, groups: [{ id: 2, name: "group", platform: "openai" }] });
    const serialized = JSON.stringify(account);
    for (const field of ["credentials", "access_token", "credentials_status", "extra", "cookie", "proxy_id", "token", "unknown", "api_keys"]) {
      expect(serialized).not.toContain(field);
    }
    expect(serialized).not.toContain("secret");
  });
});

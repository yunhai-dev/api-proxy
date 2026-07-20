// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { crossedKeyThresholds, crossedUsdThresholds, platformIncidentCooldownElapsed, sendServerChan, validServerChanUid } from "./notifications";
import { validPlatformIncidentCooldownMinutes } from "./settings";

describe("notification helpers", () => {
  test("validates ServerChan UID", () => {
    expect(validServerChanUid("123456")).toBe(true);
    expect(validServerChanUid("0")).toBe(false);
    expect(validServerChanUid("12abc")).toBe(false);
    expect(validServerChanUid("1".repeat(21))).toBe(false);
  });

  test("posts ServerChan form without query payload", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await sendServerChan("123", "send/key", "标题", "内容", fetcher);

    expect(request?.url).toBe("https://123.push.ft07.com/send/send%2Fkey.send");
    expect(request?.init?.method).toBe("POST");
    expect(String(request?.init?.body)).toBe("title=%E6%A0%87%E9%A2%98&desp=%E5%86%85%E5%AE%B9");
  });

  test("applies platform incident cooldown boundaries", () => {
    const now = 1_000_000;
    expect(platformIncidentCooldownElapsed(0, 10, now)).toBe(true);
    expect(platformIncidentCooldownElapsed(now - 600_000 + 1, 10, now)).toBe(false);
    expect(platformIncidentCooldownElapsed(now - 600_000, 10, now)).toBe(true);
    expect(platformIncidentCooldownElapsed(now, 0, now)).toBe(true);
  });

  test("validates platform incident cooldown settings", () => {
    expect(validPlatformIncidentCooldownMinutes(0)).toBe(true);
    expect(validPlatformIncidentCooldownMinutes(1440)).toBe(true);
    expect(validPlatformIncidentCooldownMinutes(-1)).toBe(false);
    expect(validPlatformIncidentCooldownMinutes(1.5)).toBe(false);
    expect(validPlatformIncidentCooldownMinutes("10")).toBe(false);
    expect(validPlatformIncidentCooldownMinutes(1441)).toBe(false);
  });

  test("detects USD remaining threshold crossings", () => {
    expect(crossedUsdThresholds(70, 91, 100)).toEqual([20, 10]);
    expect(crossedUsdThresholds(91, 100, 100)).toEqual([0]);
    expect(crossedUsdThresholds(91, 92, 100)).toEqual([]);
    expect(crossedUsdThresholds(0, 1, 0)).toEqual([]);
  });

  test("detects key usage threshold crossings", () => {
    expect(crossedKeyThresholds(70, 85, 100)).toEqual([80]);
    expect(crossedKeyThresholds(85, 101, 100)).toEqual([100]);
    expect(crossedKeyThresholds(101, 102, 100)).toEqual([]);
    expect(crossedKeyThresholds(0, 1, 0)).toEqual([]);
  });
});

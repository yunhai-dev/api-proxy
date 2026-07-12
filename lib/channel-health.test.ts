// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { circuitAllows, nextCircuitState } from "./channel-health";

describe("channel circuit state", () => {
  test("opens on a classified failure and blocks until cooldown", () => {
    const opened = nextCircuitState({ state: "closed", openedAt: 0, ok: false, now: 1_000 });
    expect(opened).toEqual({ state: "open", openedAt: 1_000 });
    expect(circuitAllows({ circuitState: opened.state, circuitOpenedAt: opened.openedAt })).toBe(false);
  });

  test("closes a successful half-open probe", () => {
    expect(nextCircuitState({ state: "half_open", openedAt: 1_000, ok: true, now: 31_001 }))
      .toEqual({ state: "closed", openedAt: 0 });
  });

  test("reopens a failed half-open probe", () => {
    expect(nextCircuitState({ state: "half_open", openedAt: 1_000, ok: false, now: 31_001 }))
      .toEqual({ state: "open", openedAt: 31_001 });
  });
});

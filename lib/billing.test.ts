// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";
import { applyBillingMultipliers } from "./billing";

const settings = {
  globalBillingMultiplier: 1,
  claudeBillingMultiplier: 1,
  openaiBillingMultiplier: 1,
};

describe("provider billing multipliers", () => {
  test("keeps the base cost at default multipliers", () => {
    expect(applyBillingMultipliers(2, "claude", settings)).toBe(2);
  });

  test("applies global and provider multipliers once", () => {
    expect(applyBillingMultipliers(2, "claude", { ...settings, globalBillingMultiplier: 3, claudeBillingMultiplier: 5 })).toBe(30);
  });

  test("supports decimal multipliers", () => {
    expect(applyBillingMultipliers(2, "claude", { ...settings, globalBillingMultiplier: 1.5, claudeBillingMultiplier: 0.8 })).toBeCloseTo(2.4);
  });

  test("uses the matching provider multiplier", () => {
    const multipliers = { ...settings, claudeBillingMultiplier: 2, openaiBillingMultiplier: 4 };
    expect(applyBillingMultipliers(3, "claude", multipliers)).toBe(6);
    expect(applyBillingMultipliers(3, "openai", multipliers)).toBe(12);
  });

  test("allows one provider multiplier to disable billing", () => {
    const multipliers = { ...settings, claudeBillingMultiplier: 0, openaiBillingMultiplier: 2 };
    expect(applyBillingMultipliers(3, "claude", multipliers)).toBe(0);
    expect(applyBillingMultipliers(3, "openai", multipliers)).toBe(6);
  });

  test("allows the global multiplier to disable billing", () => {
    const multipliers = { ...settings, globalBillingMultiplier: 0, claudeBillingMultiplier: 2, openaiBillingMultiplier: 3 };
    expect(applyBillingMultipliers(3, "claude", multipliers)).toBe(0);
    expect(applyBillingMultipliers(3, "openai", multipliers)).toBe(0);
  });

  test("returns zero for invalid or negative consumption", () => {
    expect(applyBillingMultipliers(-2, "claude", settings)).toBe(0);
    expect(applyBillingMultipliers(2, "claude", { ...settings, claudeBillingMultiplier: -1 })).toBe(0);
    expect(applyBillingMultipliers(Number.NaN, "claude", settings)).toBe(0);
    expect(applyBillingMultipliers(Infinity, "claude", settings)).toBe(0);
  });
});

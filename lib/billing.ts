import type { AppSettings } from "./settings";
import type { Provider } from "./upstream";

type BillingSettings = Pick<AppSettings, "globalBillingMultiplier" | "claudeBillingMultiplier" | "openaiBillingMultiplier">;

export function applyBillingMultipliers(baseCost: number, provider: Provider, settings: BillingSettings) {
  const providerMultiplier = provider === "claude" ? settings.claudeBillingMultiplier : settings.openaiBillingMultiplier;
  return baseCost * settings.globalBillingMultiplier * providerMultiplier;
}

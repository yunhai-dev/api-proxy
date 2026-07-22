// @ts-expect-error Bun provides this module at test runtime.
import { expect, test } from "bun:test";
import { settingsFromRows } from "./settings";

test("provider fallback settings preserve canonical falsy values and inherit absent legacy values", () => {
  const settings = settingsFromRows([
    { key: "fallbackEnabled", value: "1" },
    { key: "fallbackChannelId", value: "legacy-channel" },
    { key: "fallbackModel", value: "legacy-model" },
    { key: "claudeFallbackEnabled", value: "0" },
    { key: "claudeFallbackChannelId", value: "" },
    { key: "claudeFallbackModel", value: "" },
  ]);

  expect(settings.claudeFallbackEnabled).toBe(false);
  expect(settings.claudeFallbackChannelId).toBe("");
  expect(settings.claudeFallbackModel).toBe("");
  expect(settings.openaiFallbackEnabled).toBe(true);
  expect(settings.openaiFallbackChannelId).toBe("legacy-channel");
  expect(settings.openaiFallbackModel).toBe("legacy-model");
});

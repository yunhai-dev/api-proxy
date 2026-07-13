// @ts-expect-error Bun provides this module at test runtime.
import { expect, mock, test } from "bun:test";

let insertResults: { id: number }[][] = [];
let keyUpdates = 0;
let quotaUpdates = 0;
let statUpdates = 0;

const pgSchema = {
  requestLogs: { id: "request-log-id" },
  keys: { id: "key-id", used: "key-used", lastUsedAt: "key-last-used" },
  userQuotas: { userId: "quota-user-id", dailyUsedTokens: "daily-tokens", monthlyUsedTokens: "monthly-tokens", dailyUsedUsd: "daily-usd", monthlyUsedUsd: "monthly-usd", usedUsd: "used-usd", updatedAt: "updated-at" },
  modelPrices: {},
};

function writer() {
  return {
    insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => insertResults.shift() ?? [] }) }) }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => table === pgSchema.requestLogs ? [{ id: 42 }] : table === pgSchema.keys ? [{ userId: "user-1" }] : [{}],
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: () => ({
        where: async () => {
          if (table === pgSchema.keys) keyUpdates += 1;
          if (table === pgSchema.userQuotas) quotaUpdates += 1;
        },
      }),
    }),
  };
}

const pgDb = {
  transaction: async (callback: (tx: ReturnType<typeof writer>) => Promise<void>) => callback(writer()),
};

mock.module("./db", () => ({ db: {}, schema: {} }));
mock.module("./db/runtime", () => ({ usePostgres: () => true }));
mock.module("./db/pg", () => ({ pgDb, pgSchema }));
mock.module("./model-variants", () => ({ modelLookupCandidates: (model: string) => [model] }));
mock.module("./redis", () => ({ getRedis: async () => null }));
mock.module("./settings", () => ({ getSettings: () => ({ globalBillingMultiplier: 1 }), getSettingsAsync: async () => ({ globalBillingMultiplier: 1 }) }));
mock.module("./request-stats", () => ({ upsertRequestStatAsync: async () => { statUpdates += 1; } }));

const { logHub } = await import("./log-generator");

const entry = {
  requestId: "request-1",
  ts: 1,
  keyId: "key-1",
  keyName: "test key",
  keyPrefix: "sk-relay-test",
  channelId: "channel-1",
  channelName: "test channel",
  channelType: "openai" as const,
  model: "gpt-test",
  inboundModel: "gpt-test",
  upstreamModel: "gpt-test",
  mappingId: "",
  mappedChannelIds: [],
  requestDetail: null,
  status: 200,
  latencyMs: 10,
  tokensIn: 2,
  tokensOut: 3,
  errorMsg: null,
  cost: 0,
};

test("PostgreSQL request IDs prevent duplicate durable accounting", async () => {
  insertResults = [[{ id: 42 }], []];
  keyUpdates = 0;
  quotaUpdates = 0;
  statUpdates = 0;

  const first = await logHub.recordAsync(entry);
  const duplicate = await logHub.recordAsync(entry);

  expect(first.id).toBe(42);
  expect(duplicate.id).toBe(42);
  expect(keyUpdates).toBe(1);
  expect(quotaUpdates).toBe(1);
  expect(statUpdates).toBe(1);
});

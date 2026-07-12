// @ts-expect-error Bun provides this module at test runtime.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type FakeRedis = {
  values: Map<string, number>;
  eval: (script: string, input: { keys: string[]; arguments: string[] }) => Promise<number>;
};

let redis: FakeRedis | null = null;

mock.module("@/lib/redis", () => ({
  getRedis: async () => redis,
}));

const { reserveTpm, settleTpmReservation } = await import("./rate-limit");

function fakeRedis(): FakeRedis {
  const values = new Map<string, number>();
  return {
    values,
    async eval(script, { keys, arguments: args }) {
      if (script.includes("reservationTtl")) {
        const [keyLimit, tokens, userLimit] = args.map(Number);
        const [keyWindow, keyReservation, userWindow, userReservation] = keys;
        if (keyLimit > 0 && (values.get(keyWindow) ?? 0) + tokens > keyLimit) return 0;
        if (userLimit > 0 && (values.get(userWindow) ?? 0) + tokens > userLimit) return 0;
        if (keyLimit > 0) {
          values.set(keyWindow, (values.get(keyWindow) ?? 0) + tokens);
          values.set(keyReservation, tokens);
        }
        if (userLimit > 0) {
          values.set(userWindow, (values.get(userWindow) ?? 0) + tokens);
          values.set(userReservation, tokens);
        }
        return 1;
      }

      const [window, reservation] = keys;
      const reserved = values.get(reservation);
      if (reserved === undefined) return 0;
      values.delete(reservation);
      const actual = Number(args[0]);
      if (actual >= 0 && actual < reserved) {
        values.set(window, Math.max(0, (values.get(window) ?? 0) - reserved + actual));
      }
      return 1;
    },
  };
}

function tpm(scope: "key" | "user", id: string) {
  return [...redis!.values.entries()].find(([key]) => key.startsWith(`rl:${scope}:${id}:tpm:`))?.[1] ?? 0;
}

beforeEach(() => {
  redis = fakeRedis();
});

describe("TPM reservations", () => {
  test("rejects without partially charging either scope", async () => {
    const result = await reserveTpm({
      requestId: "request-1", keyId: "key-1", keyLimit: 100,
      userId: "user-1", userLimit: 50, tokens: 60,
    });

    expect(result).toBe(false);
    expect(tpm("key", "key-1")).toBe(0);
    expect(tpm("user", "user-1")).toBe(0);
  });

  test("settles once and refunds only unused known tokens", async () => {
    const reservation = await reserveTpm({
      requestId: "request-2", keyId: "key-2", keyLimit: 100,
      userId: "user-2", userLimit: 100, tokens: 80,
    });
    expect(reservation).not.toBe(false);
    expect(reservation).not.toBeNull();
    if (!reservation) throw new Error("expected TPM reservation");

    await settleTpmReservation(reservation, 30);
    await settleTpmReservation(reservation, 0);

    expect(tpm("key", "key-2")).toBe(30);
    expect(tpm("user", "user-2")).toBe(30);
  });

  test("keeps the conservative charge when actual use is unknown", async () => {
    const reservation = await reserveTpm({
      requestId: "request-3", keyId: "key-3", keyLimit: 100,
      userId: "user-3", userLimit: 100, tokens: 80,
    });
    expect(reservation).not.toBe(false);
    expect(reservation).not.toBeNull();
    if (!reservation) throw new Error("expected TPM reservation");

    await settleTpmReservation(reservation, null);

    expect(tpm("key", "key-3")).toBe(80);
    expect(tpm("user", "user-3")).toBe(80);
  });
});

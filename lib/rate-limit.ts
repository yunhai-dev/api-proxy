import { getRedis } from "@/lib/redis";

const CHECK_AND_INCR_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', key) or '0')
if current >= limit then
  return 0
end
current = redis.call('INCR', key)
redis.call('PEXPIRE', key, ttl)
if current > limit then
  return 0
end
return 1
`;

const RESERVE_TPM_SCRIPT = `
local keyLimit = tonumber(ARGV[1])
local tokens = tonumber(ARGV[2])
local userLimit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local reservationTtl = tonumber(ARGV[5])
if keyLimit > 0 and tonumber(redis.call('GET', KEYS[1]) or '0') + tokens > keyLimit then return 0 end
if userLimit > 0 and tonumber(redis.call('GET', KEYS[3]) or '0') + tokens > userLimit then return 0 end
if keyLimit > 0 then
  redis.call('INCRBY', KEYS[1], tokens)
  redis.call('PEXPIRE', KEYS[1], ttl)
  redis.call('SET', KEYS[2], tokens, 'PX', reservationTtl)
end
if userLimit > 0 then
  redis.call('INCRBY', KEYS[3], tokens)
  redis.call('PEXPIRE', KEYS[3], ttl)
  redis.call('SET', KEYS[4], tokens, 'PX', reservationTtl)
end
return 1
`;

const SETTLE_TPM_SCRIPT = `
local reserved = tonumber(redis.call('GET', KEYS[2]) or '')
if not reserved then return 0 end
redis.call('DEL', KEYS[2])
local actual = tonumber(ARGV[1])
if actual >= 0 and actual < reserved and redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('DECRBY', KEYS[1], reserved - actual)
  if tonumber(redis.call('GET', KEYS[1]) or '0') < 0 then redis.call('SET', KEYS[1], 0) end
end
return 1
`;

const WINDOW_MS = 60_000;
const RESERVATION_TTL_MS = 15 * 60_000;

type Scope = "key" | "user";

export type TpmReservation = { requestId: string; keyId: string; userId: string };

export async function reserveTpm(input: {
  requestId: string;
  keyId: string;
  keyLimit: number;
  userId: string;
  userLimit: number;
  tokens: number;
}): Promise<TpmReservation | false | null> {
  if (input.tokens <= 0 || (input.keyLimit <= 0 && input.userLimit <= 0)) return null;
  const redis = await getRedis();
  if (!redis) return null;
  const keyId = input.keyLimit > 0 ? input.keyId : "";
  const userId = input.userLimit > 0 ? input.userId : "";
  const ok = await redis.eval(RESERVE_TPM_SCRIPT, {
    keys: [
      windowKey("key", keyId, "tpm"), reservationKey("key", keyId, input.requestId),
      windowKey("user", userId, "tpm"), reservationKey("user", userId, input.requestId),
    ],
    arguments: [
      String(Math.max(0, input.keyLimit)), String(Math.ceil(input.tokens)),
      String(Math.max(0, input.userLimit)), String(WINDOW_MS), String(RESERVATION_TTL_MS),
    ],
  });
  return ok === 1 ? { requestId: input.requestId, keyId, userId } : false;
}

export async function settleTpmReservation(reservation: TpmReservation, actualTokens: number | null) {
  const redis = await getRedis();
  if (!redis) return;
  const actual = actualTokens === null ? -1 : Math.max(0, Math.ceil(actualTokens));
  await Promise.all([
    reservation.keyId && redis.eval(SETTLE_TPM_SCRIPT, {
      keys: [windowKey("key", reservation.keyId, "tpm"), reservationKey("key", reservation.keyId, reservation.requestId)],
      arguments: [String(actual)],
    }),
    reservation.userId && redis.eval(SETTLE_TPM_SCRIPT, {
      keys: [windowKey("user", reservation.userId, "tpm"), reservationKey("user", reservation.userId, reservation.requestId)],
      arguments: [String(actual)],
    }),
  ]);
}

export async function consumeRpm(scope: Scope, id: string, limit: number) {
  if (limit <= 0) return null;
  const redis = await getRedis();
  if (!redis) return null;
  const ok = await redis.eval(CHECK_AND_INCR_SCRIPT, {
    keys: [windowKey(scope, id, "rpm")],
    arguments: [String(limit), String(WINDOW_MS)],
  });
  return ok === 1;
}

export async function checkTpm(scope: Scope, id: string, limit: number) {
  if (limit <= 0) return null;
  const redis = await getRedis();
  if (!redis) return null;
  const current = Number(await redis.get(windowKey(scope, id, "tpm")) ?? 0);
  return current < limit;
}

export async function addTpm(scope: Scope, id: string, tokens: number) {
  if (tokens <= 0) return;
  const redis = await getRedis();
  if (!redis) return;
  const key = windowKey(scope, id, "tpm");
  await redis.multi().incrBy(key, Math.max(0, Math.round(tokens))).pExpire(key, WINDOW_MS).exec();
}

function windowKey(scope: Scope, id: string, metric: "rpm" | "tpm") {
  return `rl:${scope}:${id}:${metric}:${Math.floor(Date.now() / WINDOW_MS)}`;
}

function reservationKey(scope: Scope, id: string, requestId: string) {
  return `rl:${scope}:${id}:tpm-reservation:${requestId}`;
}

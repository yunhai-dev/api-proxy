import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { createClient } from "redis";

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL ?? "postgres://api_proxy:api_proxy_dev_password@localhost:5432/api_proxy";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const pg = postgres(databaseUrl, { max: 1 });
const redisA = createClient({ url: redisUrl });
const redisB = createClient({ url: redisUrl });
const redisSub = createClient({ url: redisUrl });

const acquireScript = `
local key = KEYS[1]
local token = ARGV[1]
local limit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - ttl)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, token)
  redis.call('PEXPIRE', key, ttl)
  return 1
end
return 0
`;

const releaseScript = `
redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
end
return 1
`;

async function verifyPostgres() {
  await pg`select 1`;
  const rows = await pg`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('request_logs', 'channels', 'keys', 'model_mappings')
  `;
  const names = new Set(rows.map(row => row.table_name));
  for (const table of ["request_logs", "channels", "keys", "model_mappings"]) {
    if (!names.has(table)) throw new Error(`missing table: ${table}`);
  }
  const indexes = await pg`
    select indexname
    from pg_indexes
    where schemaname = 'public' and tablename = 'request_logs'
  `;
  if (!indexes.some(row => row.indexname === "request_logs_key_request_id_idx")) {
    throw new Error("missing request usage idempotency index");
  }
  console.log("postgres: ok");
}

async function verifyRequestIdempotency() {
  const requestId = `verify-request:${crypto.randomUUID()}`;
  const keyId = `verify-key:${crypto.randomUUID()}`;
  try {
    const first = await pg`
      insert into request_logs (request_id, ts, key_id, channel_id, model, status, latency_ms)
      values (${requestId}, ${Date.now()}, ${keyId}, 'verify-channel', 'verify-model', 200, 0)
      returning id
    `;
    const duplicate = await pg`
      insert into request_logs (request_id, ts, key_id, channel_id, model, status, latency_ms)
      values (${requestId}, ${Date.now()}, ${keyId}, 'verify-channel', 'verify-model', 200, 0)
      on conflict do nothing
      returning id
    `;
    if (first.length !== 1 || duplicate.length !== 0) throw new Error("request usage idempotency failed");
    console.log("request usage idempotency: ok");
  } finally {
    await pg`delete from request_logs where request_id = ${requestId} and key_id = ${keyId}`;
  }
}

async function verifyRedisSemaphore() {
  const key = `verify:sem:${crypto.randomUUID()}`;
  const tokenA = crypto.randomUUID();
  const tokenB = crypto.randomUUID();
  const first = await redisA.eval(acquireScript, { keys: [key], arguments: [tokenA, "1", "30000", String(Date.now())] });
  const second = await redisB.eval(acquireScript, { keys: [key], arguments: [tokenB, "1", "30000", String(Date.now())] });
  if (first !== 1) throw new Error("first semaphore acquire failed");
  if (second !== 0) throw new Error("second semaphore acquire should be blocked by distributed limit");
  await redisA.eval(releaseScript, { keys: [key], arguments: [tokenA] });
  const third = await redisB.eval(acquireScript, { keys: [key], arguments: [tokenB, "1", "30000", String(Date.now())] });
  if (third !== 1) throw new Error("semaphore acquire after release failed");
  await redisB.eval(releaseScript, { keys: [key], arguments: [tokenB] });
  console.log("redis semaphore: ok");
}

async function verifyRedisFanout() {
  const channel = `verify:fanout:${crypto.randomUUID()}`;
  const payload = `msg:${crypto.randomUUID()}`;
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("redis pubsub timeout")), 5000);
    redisSub.subscribe(channel, message => {
      if (message === payload) {
        clearTimeout(timer);
        resolve(message);
      }
    }).catch(reject);
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  await redisA.publish(channel, payload);
  await received;
  await redisSub.unsubscribe(channel);
  console.log("redis pubsub: ok");
}

try {
  await redisA.connect();
  await redisB.connect();
  await redisSub.connect();
  await verifyPostgres();
  await verifyRequestIdempotency();
  await verifyRedisSemaphore();
  await verifyRedisFanout();
  console.log("multi-instance primitives: ok");
} finally {
  await Promise.allSettled([redisA.quit(), redisB.quit(), redisSub.quit()]);
  await pg.end();
}

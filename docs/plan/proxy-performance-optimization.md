# 代理性能优化设计文档

## Background & Goals

**问题**：单次 API 转发请求在首次上游调用之前约有 13 次 PostgreSQL 查询和 10 次 Redis 往返，全部串行。流式请求的首字节（TTFB）被日志数据库事务阻塞，非流式请求在响应返回前还需等待完整日志、计费和健康记录。

**目标**：
- 消除代理热路径中的重复数据库查询
- 将日志和计费写入移出响应关键路径（异步队列）
- 流式 TTFB 减少至上游首字节延迟 + 极小开销
- 非流式响应在上游响应体接收完成后立即返回
- 接受"最终一致"：进程崩溃窗口内（毫秒至秒级）日志可能丢失，额度短暂超用
- 接受 TTL 自动过期缓存（settings 30s，channel/catalog 5s）

---

## High-Level Design

### 核心策略

1. **请求上下文快照（RequestContext）**：在 `proxyOnce()` 开头一次性加载 settings、userQuota、effectiveLimits，后续所有子函数接收参数而不重新查库。

2. **进程内 TTL 缓存（RequestCache）**：settings、channel 列表、model catalog、model prices 使用带 TTL 的内存缓存。多实例部署时各实例独立缓存，在 TTL 内容忍短暂不一致。

3. **异步日志队列（AsyncLogQueue）**：日志、计费、用量更新、统计写入全部进入内存队列，由后台 drain worker 批量写入数据库。代理主路径只做内存操作，不等待 DB IO。

4. **响应优先释放**：
   - 流式：上游第一个有效 SSE 事件收到后立即返回 Response，初始日志写入不阻塞 enqueue。
   - 非流式：上游响应体接收完成、协议转换完成后立即返回 Response，日志异步写入。
   - Key/User 并发槽在 Response 构造完成后立即释放，不等待日志写入。

5. **并行化独立查询**：将 settings/quota/key、mapping/catalog/channel 等相互独立的查询并行执行。

---

## 模块变更范围

| 模块 | 变更类型 |
|---|---|
| `lib/request-cache.ts` | 新建：带 TTL 的进程内缓存 |
| `lib/async-log-queue.ts` | 新建：内存日志队列 + 后台 drain |
| `lib/settings.ts` | 改：`getSettingsAsync` 读缓存 |
| `lib/proxy.ts` | 改：构建 RequestContext，并行查询，日志异步化，槽位提前释放 |
| `lib/log-generator.ts` | 改：`recordAsync`/`updateAsync` 写队列而非直接写库 |

---

## Implementation Plan

### Stage 1：进程内 TTL 缓存（lib/request-cache.ts）

**Files modified**: `lib/request-cache.ts`（新建）, `lib/settings.ts`

**具体逻辑**：

新建 `lib/request-cache.ts`，提供通用 TTL 缓存单例：

```ts
type CacheEntry<T> = { value: T; expiresAt: number };

class RequestCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry || Date.now() > entry.expiresAt) { this.store.delete(key); return undefined; }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

declare global { var __requestCache: RequestCache | undefined; }
export const requestCache = globalThis.__requestCache ??= new RequestCache();
```

修改 `lib/settings.ts` 中 `getSettingsAsync()`：

```ts
export async function getSettingsAsync(): Promise<AppSettings> {
  const cached = requestCache.get<AppSettings>("settings");
  if (cached) return cached;
  // 原有查库逻辑
  const result = await fetchSettingsFromDb();
  requestCache.set("settings", result, 30_000); // TTL 30s
  return result;
}
```

对 channel、model catalog、model prices 添加类似的 TTL 缓存包装（5s TTL）。

**Validation**：
- `bunx tsc --noEmit` 通过
- 手动改 settings，30s 内新请求仍用旧值，30s 后自动更新

---

### Stage 2：RequestContext 快照，消除重复查询（lib/proxy.ts）

**Files modified**: `lib/proxy.ts`, `lib/user-quota.ts`

**具体逻辑**：

在 `proxyOnce()` 开头并行加载所有请求级数据：

```ts
const [settings, keyResult, userQuotaResult] = await Promise.all([
  getSettingsAsync(),                             // 读缓存，<1ms
  resolveApiKeyAsync(req.rawAuth),                // 1 PG
  key.userId ? loadUserQuota(key.userId) : null,  // 1 PG（等 key 后执行）
]);
```

实际上 key 必须先拿到才能知道 userId，所以：

```ts
const settings = await getSettingsAsync();           // 读缓存
const keyResult = await resolveApiKeyAsync(req.rawAuth); // 1 PG
if (!keyResult.ok) return earlyExit(...);
const key = keyResult.key;

// 并行加载用户额度 + 有效限制
const [userQuota, effectiveLimits] = await Promise.all([
  loadUserQuota(key.userId),   // 1 PG（首次加载后缓存在 ctx 中）
  /* effectiveLimits 从 userQuota + settings 计算，纯内存，无需查库 */
]);
```

创建 `RequestContext` 对象，贯穿整个请求生命周期：

```ts
const ctx: RequestContext = {
  settings,
  key,
  userQuota,
  effectiveLimits: computeEffectiveLimits(userQuota, settings),
  // ... 其他字段
};
```

修改 `checkUserQuota`、`effectiveUserTpmLimit`、`userMaxConcurrency`、`checkKeyRateLimit` 接受 `ctx` 参数，不再内部重新查库。

修改 `recordFailure`、`requestDetail` 中的 `getSettingsAsync()` 调用为直接使用 `ctx.settings`。

**Validation**：
- `bunx tsc --noEmit` 通过
- 请求前后数据库查询日志对比，settings/userQuota 不再重复出现

---

### Stage 3：并行化 mapping/catalog/channel 查询（lib/proxy.ts）

**Files modified**: `lib/proxy.ts`

**具体逻辑**：

当前：
```ts
const { mappings } = await modelMappingCandidateAsync(req.type, modelCandidates); // PG
const { catalog } = await modelConfigCandidateAsync(req.type, modelCandidates);    // PG
```

改为：
```ts
const [{ mappings }, { catalog }] = await Promise.all([
  modelMappingCandidateAsync(req.type, modelCandidates),   // PG，从缓存或查库
  modelConfigCandidateAsync(req.type, modelCandidates),    // PG，从缓存或查库
]);
```

渠道列表查询也加入 TTL 缓存，同一 Provider 在 5s TTL 内只查一次，多个 mapping 路由直接复用。

RPM + TPM 检查并行：
```ts
// 当前串行
const rpmOk = await consumeRpm("user", ...);
const tpmOk = await checkTpm("user", ...);

// 改为并行（RPM 写操作和 TPM 读操作互相独立）
const [rpmOk, tpmOk] = await Promise.all([
  consumeRpm("user", key.userId, limits.rateLimitRpm),
  checkTpm("user", key.userId, limits.rateLimitTpm),
]);
```

同样并行 Key 的 RPM + TPM：
```ts
const [keyRpmOk, keyTpmOk] = await Promise.all([
  consumeRpm("key", key.id, key.rateLimitRpm),
  checkTpm("key", key.id, key.rateLimitTpm),
]);
```

**Validation**：
- `bunx tsc --noEmit` 通过
- 对比优化前后查询时序日志，并行查询在同一时间窗口发出

---

### Stage 4：异步日志队列（lib/async-log-queue.ts）

**Files modified**: `lib/async-log-queue.ts`（新建）, `lib/log-generator.ts`

**具体逻辑**：

新建 `lib/async-log-queue.ts`，实现内存队列 + 后台 drain 模式（类似已有的 `kickNotificationDrain`）：

```ts
type LogJob =
  | { type: "record"; input: LogInput }
  | { type: "update"; id: number; input: LogInput };

const queue: LogJob[] = [];
let draining = false;

export function enqueueLog(job: LogJob) {
  queue.push(job);
  kickDrain();
}

function kickDrain() {
  if (draining) return;
  draining = true;
  void drain().finally(() => { draining = false; });
}

async function drain() {
  while (queue.length > 0) {
    const batch = queue.splice(0, 50); // 批量取出，最多 50 条
    await Promise.allSettled(batch.map(job =>
      job.type === "record"
        ? logHub.recordDirectAsync(job.input)   // 直接写库
        : logHub.updateDirectAsync(job.id, job.input)
    ));
  }
}
```

修改 `LogHub.recordAsync()` 和 `updateAsync()` 改为：
1. 把 `LogInput` 推入队列
2. 立即返回一个占位 `LogEntry`（id 可以在内存中先生成）
3. 把 SSE 广播（`emit` + `publish`）改为在入队时立即执行（因为 Redis pub/sub 本来就是 fire-and-forget）

**进程内 id 生成**：

将 `rawLogId` 改为使用 `crypto.randomUUID()` 生成本地 ID（或在实际写入后更新），保证流式初始日志和最终更新可以关联。

具体方案：
- 日志入队时，`requestId`（UUID，已存在）作为关联键
- 初始写入用 `INSERT ... ON CONFLICT (requestId) DO NOTHING`，保持幂等
- 最终更新用 `UPDATE ... WHERE requestId = ?`，不依赖 rowid

**Validation**：
- `bunx tsc --noEmit` 通过
- 发起请求，响应立即返回，日志在 1s 内异步写入数据库
- 进程杀死后重启，确认最近几条日志可能缺失（接受）

---

### Stage 5：流式响应提前返回（lib/proxy.ts）

**Files modified**: `lib/proxy.ts`

**具体逻辑**：

当前流式路径：
```
收到首个有效 SSE → 构造 Response → 返回 Response → 客户端第一次 pull → 等待初始日志 DB 事务 → 发送首字节
```

目标路径：
```
收到首个有效 SSE → 构造 Response → 返回 Response → 客户端第一次 pull → 立即发送首字节 + 异步入队初始日志
```

修改 `makeStreamResponseFromPrelude` 中的 `ensureInitialLog()`：

```ts
// 当前
async function ensureInitialLog(): Promise<number> {
  if (logId !== null) return logId;
  // 等待完整 DB 事务 ...
  logId = result.id;
  return logId;
}

// 改为
function ensureInitialLog(): void {
  if (logEnqueued) return;
  logEnqueued = true;
  // 入队，不等待
  enqueueLog({ type: "record", input: buildInitialLogInput() });
}
```

`pull()` 中不再 `await ensureInitialLog()`，改为同步调用并立即 enqueue：

```ts
pull(controller) {
  ensureInitialLog(); // 同步入队，不 await
  // 直接 enqueue 已准备好的数据
  if (preludeChunks.length > 0) {
    controller.enqueue(preludeChunks.shift()!);
    return;
  }
  // 继续读取上游 ...
}
```

Key/User 并发槽在 `prepareStreamResponse` 成功后立即释放，不等待流结束：

```ts
// 在 proxyOnce 中，stream 路径
const streamResp = await prepareStreamResponse(...);
releaseAllKeySlots();   // 立即释放，不等流结束
return { kind: "success", response: streamResp.response, ... };
```

注意：渠道并发槽仍然在流结束/取消时释放，保持渠道并发控制有效。

**Validation**：
- 流式请求用 `curl -N` 观察，首字节在毫秒级到达
- 取消请求，日志仍然异步写入（状态 499）

---

### Stage 6：非流式响应提前返回（lib/proxy.ts）

**Files modified**: `lib/proxy.ts`

**具体逻辑**：

当前非流式路径在 `proxyOnce` 中的顺序：
```ts
processed = await collectResponse(result, ctx, ...);
await recordChannelObservation(route.channel, { ok: true, ... }); // 2 PG
await recordSuccessOrAcceptedEmpty(ctx, processed.info, null);    // 11+ PG
await settleTpm(processed.info.tokensIn + processed.info.tokensOut);
releaseAllKeySlots();
return { kind: "success", response: processed.response, ... };
```

改为：
```ts
processed = await collectResponse(result, ctx, ...);
releaseAllKeySlots();  // 立即释放并发槽

// 构造要异步执行的记录任务
void Promise.all([
  recordChannelObservation(route.channel, { ok: true, ... }),  // 2 PG，异步
  enqueueSuccessLog(ctx, processed.info),                      // 入队，异步
  settleTpm(processed.info.tokensIn + processed.info.tokensOut), // Redis，异步
]).catch(() => null);

resolveProxyIncidents();
return { kind: "success", response: processed.response, ... };
```

`recordFailure` 同理，错误响应也改为异步写日志（401 本来就不写，其他错误码也改为入队）。

**Validation**：
- 非流式请求 `time curl ...`，延迟应接近上游响应时间，不再有额外数据库延迟
- 日志在 1s 内异步出现在数据库

---

### Stage 7：渠道饱和度检查优化（lib/redis-semaphore.ts, lib/channel-queue.ts）

**Files modified**: `lib/redis-semaphore.ts`, `lib/channel-queue.ts`

**具体逻辑**：

当前 `isChannelSaturated` 用 2 次串行命令：
```ts
await redis.zRemRangeByScore(key, "-inf", expiredBefore);  // 清理
const count = await redis.zCard(key);                       // 计数
```

改为一个 Lua 脚本：
```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - 30000)
local count = redis.call('ZCARD', key)
return count >= capacity and 1 or 0
```

这样 `isChannelSaturated` 变为单次 Redis 往返。

另外，在 `proxyOnce` 中按唯一 channelId 去重后再并行检查饱和度：

```ts
const uniqueChannelIds = [...new Set(pool.map(r => r.channel.id))];
const saturationMap = new Map(
  await Promise.all(
    uniqueChannelIds.map(async id => {
      const channel = pool.find(r => r.channel.id === id)!.channel;
      return [id, await isChannelSaturated(id, channel.maxConcurrency ?? 0)] as const;
    })
  )
);
```

**Validation**：
- `bunx tsc --noEmit` 通过
- Redis 监控中 `isChannelSaturated` 每次调用只有 1 次命令而非 2 次

---

### Stage 8：流控、节点计时与增量转换诊断

**Files modified**: `lib/proxy.ts`, `lib/proxy-lifecycle.test.ts`

**具体逻辑**：
- 流式 `pull()` 持续读取上游，直到产生可下发字节、流结束或报错，避免协议转换遇到心跳/usage/lifecycle 空输出事件后停止拉取。
- 通过 `Server-Timing` 返回 settings、鉴权、额度/限流、Key 队列、路由、TPM 预留、渠道队列、上游响应头和首个有效事件耗时。
- SSE usage 改为只解析新到达的完整行，不再每个 chunk 重扫最多 256 KiB 历史数据。
- 协议输出保持逐事件转换；不缓存带请求状态、工具调用索引和随机响应 ID 的转换结果。

**Validation**：
- 受控上游在两个文本事件之间插入无输出 usage 事件，客户端仍收到第二个文本事件并正常结束。
- 原生与跨协议流式响应包含 `Server-Timing`，可直接定位慢节点。
- 协议转换测试、代理生命周期测试、类型检查和构建通过。

**验证结果（2026-07-29）**：66 项代理/协议转换测试通过，类型检查与生产构建通过；Claude → OpenAI Responses 转换基准为 10,000 个事件约 12.7ms（约 1.27µs/事件），转换计算不是秒级延迟来源。

---

## Testing Strategy

### Happy path
- 普通 Claude 请求（stream=true）：TTFB 应在网络延迟 + 上游首字节内
- 普通 OpenAI Chat 请求（stream=false）：响应时间应接近上游响应体传输时间
- 验证日志在请求返回后 1s 内出现在数据库

### Error path
- 无效 API Key → 401 快速返回，无日志（保持原行为）
- 额度超限 → 402 快速返回，日志异步写入
- 上游 429 重试 → 每次重试的渠道健康记录异步写入

### Regression scope
- `bunx tsc --noEmit`
- `bun run build`
- 额度计算正确性：连续 100 次请求后 `key.used` 累计值与实际 token 数一致（允许最终一致窗口）
- 并发测试：10 个并发请求，渠道并发槽正常限制

---

## Risks & Mitigation

| 风险 | 缓解方案 |
|---|---|
| 进程崩溃丢失队列中的日志 | 接受（用户已确认）；drain 频率高（每批最多等 50ms），崩溃窗口极小 |
| 短暂超额（key.used 延迟写入） | 接受（用户已确认）；RPM/TPM 仍走 Redis 实时检查，超额只出现在冷路径 |
| TTL 缓存期间管理员修改 settings 不立即生效 | 接受（用户已确认）；最多 30s 延迟 |
| 渠道 enable/disable 后最多 5s 继续路由 | 接受；可通过手动 invalidate 接口加急清缓存 |
| 日志写入失败（DB 不可用） | drain 内 `Promise.allSettled`，失败静默，不影响代理路径 |
| 流式连接半途断开，初始日志 id 与最终更新的关联 | 改用 requestId 作为关联键（UUID，已存在），`ON CONFLICT (requestId) DO NOTHING` 保持幂等 |

---

## Rollback Plan

每个 Stage 独立提交，Stage 之间互不依赖，可按 Stage 回滚：

- Stage 1 回滚：删除 `lib/request-cache.ts`，恢复 `getSettingsAsync` 直接查库
- Stage 4 回滚：删除 `lib/async-log-queue.ts`，恢复 `recordAsync`/`updateAsync` 直接写库
- Stage 5/6 回滚：恢复 `proxyOnce` 中 `await recordChannelObservation` + `await recordSuccessOrAcceptedEmpty` 的同步调用

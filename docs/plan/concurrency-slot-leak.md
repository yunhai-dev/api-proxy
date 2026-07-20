# 并发槽位泄漏修复设计文档

## Background & Goals

用户在没有可见活跃请求时仍可能收到“等待用户/密钥并发额度超时”。原因是流式请求收尾或 Redis 显式释放失败后，用户、Key 或渠道信号量未及时清除。

成功标准：请求正常完成、客户端取消/断线、日志收尾失败及 Redis 瞬时故障时，槽位均能及时且只释放一次；不改变现有并发上限、路由和计费策略。

## High-Level Design

代理继续使用现有用户、Key、渠道三级槽位。流式响应进入终态时，先通过幂等释放函数归还槽位，再执行日志和 TPM 结算；入站请求中断信号持续覆盖响应体生命周期。Redis release 保持幂等，并在瞬时失败时进行有界重试，持续故障仍由现有 TTL 兜底。

## Implementation Plan

### Stage 1: 流式生命周期可靠释放

- **Files modified**: `lib/proxy.ts`
- **Specific logic**: 将请求 `AbortSignal` 传入流式上下文；流提交后监听断线并取消上游 reader；将槽位释放从可能失败的日志和 TPM 结算中解耦；处理 EOF、异常、显式取消和 abort 竞态。
- **Validation**: 模拟响应头后断线和日志更新失败，确认渠道释放一次、用户与 Key 各释放一次。

### Stage 2: Redis 信号量可靠释放

- **Files modified**: `lib/redis-semaphore.ts`
- **Specific logic**: release 调用共享一个 Promise，Redis release 失败时短暂、有界重试；不向 fire-and-forget 调用泄漏拒绝，最终依赖 TTL 清理。
- **Validation**: 首次 release `EVAL` 失败、后续成功，确认只执行一次逻辑释放且重复调用安全。

### Stage 3: 回归测试与发布检查

- **Files modified**: `lib/proxy-lifecycle.test.ts`, `lib/redis-semaphore.test.ts`, `docs/IMPLEMENTATION_PLAN.md`
- **Specific logic**: 增加断线、日志失败和 Redis 瞬时失败测试；完成后更新实施索引。
- **Validation**: 运行聚焦测试、类型检查、生产构建和 diff 检查。

## Testing Strategy

- Happy path：保留正常流完成和显式 reader 取消测试。
- Error path：响应头后 `AbortSignal` 中断；最终日志更新失败；Redis release 首次失败。
- Regression scope：用户、Key、渠道并发槽位，流式 TPM 结算和请求日志。

## Risks & Mitigation

- 多个终态同时触发：使用独立幂等守卫并在释放时移除 abort listener。
- 计费收尾晚于槽位释放：上游流终止后不再占用并发是预期语义，计费仍继续执行。
- Redis 长时间不可用：仅有限重试，保留 TTL 作为最终兜底，避免无限后台任务。
- Rollback：无 schema 或配置变更，可按代码阶段独立回滚。

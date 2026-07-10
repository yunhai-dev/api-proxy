# 代理零输出高可用处理设计文档

## Background & Goals
- 部分上游会返回 HTTP 200，但 assistant 没有产生可消费输出，且 usage 输出 token 为 0。
- 既有临时逻辑只看 `tokensOut === 0`，会误伤缺失 usage 的聚合器，并可能造成日志状态与用户实际响应不一致。
- 成功标准：缺 usage 不误判；可配置开启后空输出参与重试/fallback；最终日志状态与用户实际响应一致；渠道/user/key 并发槽按路径释放。

## High-Level Design
- 新增设置项 `proxyTreatEmptyOutputAsFailure`，默认关闭。
- 非流式响应先收集、解析 usage 与可见输出，再决定成功、重试或 fallback。
- 流式响应先预读到首次可见输出或上游关闭；未承诺给客户端前可重试，已见输出后继续实时透传。
- 请求日志由最终响应路径写入，避免“先记 200 成功、后返回 502”的状态错乱。

## Implementation Plan

### Stage 1: Settings toggle
- **Files modified**: `lib/settings.ts`, `app/api/settings/route.ts`, `components/settings/settings-form.tsx`
- **Specific logic**: 增加 `proxyTreatEmptyOutputAsFailure` 类型、默认值、读取/写入、PATCH 白名单和设置页 Toggle。
- **Validation**: 设置页可展示/保存字段；TypeScript 编译通过。

### Stage 2: Empty-output detection
- **Files modified**: `lib/proxy.ts`
- **Specific logic**: `extractUsage()` 改为 `UsageTokens | null`；缺失 usage 返回 `null`；新增非流式可见输出抽取和空输出判定。
- **Validation**: 缺 usage 的响应不会被判空；有 usage 且输出 token 为 0、无可见内容时才判空。

### Stage 3: Non-stream response flow
- **Files modified**: `lib/proxy.ts`
- **Specific logic**: `collectResponse()` 返回 tagged result；日志上移到 `recordSuccessOrAcceptedEmpty()`；空输出按设置进入重试/fallback。
- **Validation**: 非流式成功、空输出重试、fallback 失败路径均只生成最终语义日志。

### Stage 4: Stream prelude/commit
- **Files modified**: `lib/proxy.ts`
- **Specific logic**: 流式响应预读到首次可见输出或关闭；空输出在提交前可重试；提交后继续从同一个 reader 实时透传并在结束时释放槽位。
- **Validation**: 正常流式响应不被完整缓冲；空流在开启配置时进入重试/fallback。

### Stage 5: Slot and failure cleanup
- **Files modified**: `lib/proxy.ts`
- **Specific logic**: `collectResponse()` 异常转为可观测失败；fallback 空输出写最终失败日志；stream commit 结束/取消时释放 channel + user/key 槽。
- **Validation**: `bunx tsc --noEmit` 与 `bun run build` 通过。

## Testing Strategy
- Happy path: 普通 Claude/OpenAI 非流式与流式响应继续成功。
- Empty path: usage 存在、output token 为 0 且无可见输出时，开启配置后按网络类失败进入重试/fallback。
- Compatibility: 缺失 usage 的 OpenAI-compatible 聚合器响应不误判。
- Regression: `bunx tsc --noEmit`、`bun run build`。

## Risks & Mitigation
- **流式误缓冲风险**：只预读到首次可见输出，随后沿同一个 reader 继续透传。
- **误判缺 usage 聚合器风险**：`usage === null` 明确不判空。
- **日志错乱风险**：非流式最终日志集中写入；流式只在 commit 后创建并结束时 update。
- **槽位泄漏风险**：失败/重试路径立即释放 channel slot；流式成功由响应关闭/取消释放所有槽位。

## Rollback Plan
- 关闭 `proxyTreatEmptyOutputAsFailure` 可恢复兼容放行行为。
- 如需代码回滚，撤销 `lib/proxy.ts` 的 detection/stream prelude 变更与设置项即可。
# 平台事件通知冷却 Design Document

## Background & Goals

- 平台通知已对持续故障去重，但故障与恢复快速切换时仍会反复通知。
- 为熔断、无可用渠道和上游尝试耗尽事件增加按 incident key 的冷却，默认 10 分钟。
- 仅抑制通知入队，不改变事件状态、熔断、重试、回退或代理响应。
- 成功标准：同一事件的告警与恢复在冷却窗口内最多入队一次，不同事件互不影响。

## High-Level Design

`setPlatformIncident()` 继续在 PostgreSQL 行锁内持久化每次状态变化。`notification_states.last_notified_at` 单独记录最近一次实际入队时间；启用的通知只有在超过设置的冷却窗口后才写入现有 outbox。被抑制的通知不延迟补发。

冷却按现有 `stateKey` 隔离：渠道熔断按渠道，上游事件按服务商和模型。告警与恢复共享同一时间戳。用户额度邮件不经过该冷却。

## Implementation Plan

### Stage 1: 设置与持久化

- **Files modified**: `lib/settings.ts`, `app/api/settings/route.ts`, `lib/db/pg-schema.ts`, `scripts/init-postgres-schema.mjs`
- **Specific logic**: 增加 `platformIncidentCooldownMinutes`（默认 10，整数范围 0–1440，0 关闭）和 `notification_states.last_notified_at`；已有数据库通过幂等 `ADD COLUMN IF NOT EXISTS` 升级。
- **Validation**: 缺失设置使用默认值，0 被保留；负数、小数、非数字和超限 PATCH 返回 400；schema 初始化可重复运行。

### Stage 2: 共享状态机冷却

- **Files modified**: `lib/notifications.ts`
- **Specific logic**: 状态变化始终更新 `active`、`generation`、`updatedAt`；通知开关开启时根据 `lastNotifiedAt` 判断是否入队，实际入队后在同一事务内更新时间戳。
- **Validation**: 无历史时间、冷却到期和设置为 0 时允许；到期前抑制；告警与恢复共享窗口。

### Stage 3: 管理界面

- **Files modified**: `components/settings/settings-form.tsx`
- **Specific logic**: 在 ServerChan 通知设置中增加冷却分钟数输入及 0 值说明，沿用现有 settings PATCH。
- **Validation**: 加载、修改和保存后值保持一致，浏览器原生范围约束与 API 校验一致。

### Stage 4: 测试与发布检查

- **Files modified**: `lib/notifications.test.ts`, `docs/IMPLEMENTATION_PLAN.md`, 本文档
- **Specific logic**: 增加纯冷却边界测试，并记录实际验证结果。
- **Validation**: `bun test lib/notifications.test.ts`、`bunx tsc --noEmit`、`bun run build`、`git diff --check`；有本地 PostgreSQL 时验证已有表升级和快速失败/恢复只入队一次。

## Testing Strategy

- Happy path: 首次事件通知；10 分钟后下一次状态变化通知；不同 `stateKey` 分别通知。
- Error path: 10 分钟内快速恢复被抑制；非法设置返回 400；设置为 0 时恢复原有频率。
- Regression scope: 渠道熔断/恢复、无可用渠道、上游尝试耗尽、用户额度邮件、通知 outbox 重试。

## Risks & Mitigation

- 快速恢复通知可能被故障告警抑制，这是降噪的预期取舍；管理员可将冷却设为 0。
- `updatedAt` 不能兼作冷却时间，否则被抑制的状态抖动会重置窗口；使用独立列避免该问题。
- 回滚代码时新增列可安全保留；关闭冷却无需数据库回滚。

# 可配置通知系统 Design Document

## Background & Goals

- 当前渠道熔断、代理终态和额度使用只记录在系统内，管理员与用户无法及时获知。
- 平台事件仅通过 ServerChan 通知管理员；用户额度事件通过 SMTP 发到账号邮箱。
- 每组通知可独立开关，状态和待发送消息持久化，多实例下去重并支持失败重试。
- 外部通知失败不得改变代理响应或计费结果。

## High-Level Design

业务状态变化先在 PostgreSQL 中更新 `notification_states` 并插入唯一的 `notification_outbox`。投递器使用短租约领取到期任务，在事务外调用 ServerChan 或现有 SMTP mailer，成功后标记完成，失败则指数退避重试。平台事件采用激活/恢复 generation；用户额度事件只在跨越阈值时发送，并在配额恢复到阈值上方后重新布防。

ServerChan 使用原生 `fetch` 表单 POST，不增加依赖。所有新开关默认关闭，SendKey 复用现有 AES-GCM 设置密钥保护。

## Implementation Plan

### Stage 1: 持久化基础
- **Files modified**: `lib/db/pg-schema.ts`, `scripts/init-postgres-schema.mjs`
- **Specific logic**: 增加通知状态与 outbox 表、唯一去重约束、待投递索引和幂等初始化 DDL。
- **Validation**: schema 初始化可重复运行，同一 dedupe key 只能插入一次。

### Stage 2: 设置与管理界面
- **Files modified**: `lib/settings.ts`, `app/api/settings/route.ts`, `components/settings/settings-form.tsx`, config import/export routes
- **Specific logic**: 增加总开关、事件开关、恢复开关及加密 ServerChan 凭据；后台支持配置和测试。
- **Validation**: 非法 UID 拒绝；SendKey 不回显、不导出、不被空值或导入覆盖。

### Stage 3: 状态机与投递器
- **Files modified**: `lib/notifications.ts`, `lib/mail-templates.ts`, `app/api/worker/notifications/route.ts`
- **Specific logic**: 实现平台事件生命周期、额度阈值 crossing/rearm、租约领取、ServerChan/SMTP 发送和失败退避。
- **Validation**: 并发激活只生成一条消息；失败任务可重领；worker 仅接受管理员或配置的 bearer secret。

### Stage 4: 平台事件接入
- **Files modified**: `lib/channel-health.ts`, `lib/proxy.ts`
- **Specific logic**: 在统一渠道观测边界处理熔断/恢复，在代理最终结果边界互斥处理无可用渠道与重试耗尽，并在后续成功时恢复。
- **Validation**: 持续故障不重复，恢复仅一次，fallback 成功不产生耗尽通知。

### Stage 5: 用户阈值接入
- **Files modified**: `lib/log-generator.ts`, `app/api/gift-cards/redeem/route.ts`, `app/api/users/[id]/quota/route.ts`
- **Specific logic**: 在幂等计费事务内比较更新前后值；充值/提高额度重新布防，降低额度可立即触发。
- **Validation**: 重复 request ID 不重复通知；无邮箱、SMTP 关闭或无限配额不发送。

### Stage 6: 测试与发布检查
- **Files modified**: notification、channel-health、proxy-lifecycle、log-generator 测试
- **Specific logic**: 覆盖状态机、阈值、outbox、脱敏及业务失败隔离。
- **Validation**: 聚焦 Bun 测试、`bunx tsc --noEmit`、`bun run build` 和可用时的 PostgreSQL schema 初始化。

## Testing Strategy

- Happy path: 每类事件首次触发、恢复、再次触发；用户阈值 crossing 与 rearm；ServerChan 和 SMTP 成功发送。
- Error path: 非法配置、无邮箱、通道关闭、发送超时、任务租约过期、重复业务事件和重复 request ID。
- Regression scope: 渠道测试与熔断、代理 fallback、请求日志计费、礼品卡核销、管理员额度修改、设置导入导出。

## Risks & Mitigation

- 外部服务已接收但本地确认失败时可能重复交付；系统明确采用 at-least-once，不引入额外消息中间件。
- 进程崩溃后依赖 pending outbox 和受保护 worker 恢复；应用内 drain 只用于降低延迟。
- payload 仅保留通知渲染所需的有界脱敏字段，禁止密钥、请求正文和用户提示词。
- 回滚时先关闭全局开关与 worker，再回滚业务挂钩；保留新表不影响旧版本。

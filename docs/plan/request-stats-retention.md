# 请求统计留存 Design Document

## Background & Goals
- 问题：`request_logs` 旧明细清理后，当前从明细聚合的请求数、Token、费用、模型/用户/Key 用量会变少。
- 目标：清理请求日志明细不影响历史统计，包括总请求数量。
- 成功标准：删除旧 `request_logs` 后，同一时间范围内 Dashboard、用户详情、Key 用量 API 的聚合结果保持不变。

## High-Level Design
- 新增 PostgreSQL 表 `request_stats`，一条请求保留一行统计事实。
- `request_stats` 保存统计必要字段，不保存 `request_detail` / `error_msg` 等大字段。
- 写请求日志时同步写入统计事实；清理旧日志前先回填未同步的历史明细。
- 统计查询改读 `request_stats`；最近日志和活跃请求仍读 `request_logs`。
- `user_id` 在写入统计事实时固化，避免 Key 后续被删除后历史统计归属变成未知用户。

## Implementation Plan

### Stage 1: 文档与 schema
- **Files modified**: `docs/IMPLEMENTATION_PLAN.md`, `docs/plan/request-stats-retention.md`, `lib/db/pg-schema.ts`, `scripts/init-postgres-schema.mjs`
- **Specific logic**: 新增 `request_stats` 表、索引、初始化 SQL 和幂等回填 SQL。
- **Validation**: TypeScript 能识别新 schema；初始化脚本可重复执行。

### Stage 2: 写入与清理前回填
- **Files modified**: `lib/request-stats.ts`, `lib/log-generator.ts`, `app/api/settings/archive/route.ts`, `app/api/keys/[id]/route.ts`
- **Specific logic**: 请求插入/更新时 upsert `request_stats`；删除请求日志前按截止时间回填；删除 Key 前先把该 Key 的历史请求补入统计表以固化 `user_id`。
- **Validation**: 新请求产生统计行；清理前缺失统计行会被补齐。

### Stage 3: 统计读取改造
- **Files modified**: `lib/stats.ts`, `lib/user-stats.ts`, `app/api/v1/usage/[key]/route.ts`
- **Specific logic**: 聚合统计改从 `request_stats` 读取；展示名称可 left join 当前 keys/users/channels，缺失时使用统计事实中的 `user_id` / `channel_type` 回退。
- **Validation**: Key 被删除或日志明细被清理后，历史统计仍按原用户归属计入。

### Stage 4: 设置页说明与验证
- **Files modified**: `components/settings/settings-form.tsx`
- **Specific logic**: 归档清理说明补充“清理明细不影响历史统计”。
- **Validation**: `bunx tsc --noEmit` 通过；代表性清理前后聚合数一致。

## Testing Strategy
- Happy path tests: 产生请求日志后 `request_stats` 有对应行，Dashboard / 用户详情 / 用量 API 数字一致。
- Error path tests: 删除 Key 后再看历史统计，仍按 `request_stats.user_id` 归属到原用户。
- Regression scope: 日志列表、日志详情、活跃请求仍使用 `request_logs`，清理后旧明细不可查看是预期行为。

## Risks & Mitigation
- 风险：已经被删除的旧明细无法恢复。Mitigation：仅保证上线后仍存在或新产生的数据被保留。
- 风险：统计表字段不足导致未来新指标无法回算。Mitigation：本次保留当前统计已用字段和用户归属字段，避免保存大详情。
- Rollback plan：统计查询可临时切回 `request_logs`；`request_stats` 表保留不影响现有明细写入。

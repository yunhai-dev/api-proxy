# 渠道级模型定价 Design Document

## Background & Goals
- 当前模型定价按 `provider + model` 唯一，无法表达同一模型在不同渠道成本不同。
- 模型广场只展示单个模型价格，无法展示不同渠道的价格差异。
- 成功标准：定价页可按渠道配置同一模型价格；统计计费优先使用渠道价并兼容旧默认价；模型广场展示渠道价格。

## High-Level Design
- 数据层：`model_prices` 增加 `channel_id`，空字符串表示旧默认价。
- 定价 API：创建定价时按 `channel_id + model` 去重；旧导入数据缺失 `channelId` 时写入默认价。
- 统计计费：按请求日志中的 `channelId` 查 `channelId:model`，找不到再回退 `provider:model` 默认价。
- 模型广场：公开模型附带可用渠道价格列表，卡片展示最低/默认价格，详情展示各渠道价格。

## Implementation Plan

### Stage 1: 数据层与初始化
- **Files modified**: `lib/db/pg-schema.ts`, `scripts/init-postgres-schema.mjs`
- **Specific logic**: 增加 `channelId` 字段，新增唯一索引 `(channel_id, model)`，初始化脚本对既有表执行 `ALTER TABLE` 与索引迁移。
- **Validation**: `bun run build` 类型检查；容器启动时 schema init 不破坏旧数据。

### Stage 2: API 与定价管理页
- **Files modified**: `app/api/model-prices/route.ts`, `app/api/config/import/route.ts`, `components/pricing/pricing-table.tsx`
- **Specific logic**: 支持 `channelId` 参数；定价页选择渠道后选择模型；列表展示渠道。
- **Validation**: 同一模型可在不同渠道分别新增定价，同一渠道同一模型重复新增返回 409。

### Stage 3: 计费与模型广场
- **Files modified**: `lib/stats.ts`, `lib/user-stats.ts`, `lib/log-generator.ts`, `lib/model-catalog.ts`, `components/models/model-square-list.tsx`
- **Specific logic**: 计费优先渠道价；模型广场展示渠道价格列表。
- **Validation**: 构建通过；旧默认价仍能显示和参与计费。

## Testing Strategy
- Happy path: 为两个渠道配置同一模型不同价格，模型广场显示两条渠道价格。
- Error path: 同一渠道同一模型重复定价返回冲突。
- Regression scope: Dashboard、排行榜、用户详情、日志消费成本仍能计算。

## Risks & Mitigation
- 旧唯一索引阻止同模型多渠道：初始化脚本显式 drop 旧索引。
- 旧价格数据无渠道：以空 `channel_id` 作为默认价回退。
- 已有运行库表缺列：初始化脚本不再只在缺表时建表，会始终执行安全迁移语句。

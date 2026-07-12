# 渠道上游模型勾选确认 Design Document

## Background & Goals
- 问题：渠道表单“从上游拉取”会直接覆盖渠道模型列表，用户没有机会选择需要保存的模型，编辑时还会误删已有自定义模型。
- 目标：拉取结果只作为候选项展示，用户勾选并确认后才追加到渠道模型列表。
- 成功标准：未确认的拉取结果不进入保存 payload；已有模型不因拉取被覆盖；复选项使用 shadcn 风格组件。

## High-Level Design
- 表单状态分三层：`models` 是已确认并会保存的模型，`fetchedModels` 是本次拉取候选，`selectedFetchedModels` 是临时勾选。
- 拉取接口 `/api/channels/models` 保持不变，只调整前端消费方式。
- `ModelMultiSelect` 增加候选区，候选区使用 shadcn `Checkbox` 和 `Label`，确认后去重追加到 `models`。

## Implementation Plan

### Stage 1: 登记计划与 shadcn 组件
- **Files modified**: `docs/IMPLEMENTATION_PLAN.md`, `docs/plan/channel-fetched-model-selection.md`, `components/ui/checkbox.tsx`, `components/ui/label.tsx`, `package.json`, `bun.lock`
- **Specific logic**: 登记任务；补齐项目缺失的 shadcn Checkbox/Label 组件及其 Radix 依赖。
- **Validation**: TypeScript 能解析新组件，样式沿用现有 token。

### Stage 2: 渠道表单状态拆分
- **Files modified**: `components/channels/channel-form.tsx`
- **Specific logic**: 新增 `fetchedModels` 和 `selectedFetchedModels`；拉取成功只更新候选状态，不再覆盖 `models`；配置变化和弹窗关闭时清空未确认候选。
- **Validation**: 拉取后不确认直接保存，payload 不包含候选模型。

### Stage 3: 候选模型复选确认 UI
- **Files modified**: `components/channels/channel-form.tsx`, `app/globals.css`
- **Specific logic**: 在模型选择区展示可滚动复选列表；勾选只改临时状态；“确认添加”去重追加到 `models`；“取消”丢弃临时状态。
- **Validation**: 编辑已有渠道时，自定义模型保留；确认新增模型后 chip 列表只追加勾选项。

## Testing Strategy
- Happy path: 添加渠道拉取模型，勾选 2 个并确认，保存 payload 仅包含这 2 个。
- Error path: 拉取失败或空结果不改变已确认模型。
- Regression scope: 自定义模型添加/删除、编辑渠道保留模型、测试模型下拉只来自已确认模型、渠道保存。

## Risks & Mitigation
- 风险：引入 Radix Checkbox/Label 增加依赖。
- 缓解：使用 shadcn 官方组件形态，范围仅 UI 基础组件。
- 回滚：删除候选状态与 Checkbox/Label 使用，恢复 fetch 后直接写 `models`。

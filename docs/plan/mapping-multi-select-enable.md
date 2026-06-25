# 模型映射批量开关 Design Document

## Background & Goals
- 问题：当前模型映射只能逐条编辑/删除，批量维护成本高；同时映射没有启用/停用状态，无法安全地临时下线某些映射。
- 目标：在映射列表页支持多选批量操作，并为映射增加启用开关。
- 成功标准：
  - 可单条或批量启用/停用映射。
  - 停用映射不再参与代理路由和候选生成。
  - 现有 CRUD、导入/导出、排序和分页保持可用。

## High-Level Design
- 数据层给 `model_mappings` 增加 `enabled` 字段，默认值为 `true`。
- API 返回并接受 `enabled`，导入/导出也携带该字段。
- 代理查询映射时过滤 `enabled = true`。
- UI 复用模型管理页的多选模式，增加行选择、全选和批量启停按钮，并在行内提供开关按钮。

## Implementation Plan

### Stage 1: 数据模型与 API
- **Files modified**: `lib/db/pg-schema.ts`, `scripts/init-postgres-schema.mjs`, `app/api/model-mappings/route.ts`, `app/api/model-mappings/[id]/route.ts`, `app/api/config/export/route.ts`, `app/api/config/import/route.ts`
- **Specific logic**:
  - 为 `model_mappings` 增加 `enabled boolean NOT NULL DEFAULT true`。
  - 创建/更新接口接收 `enabled`，列表接口返回 `enabled`。
  - 导出时包含启用状态，导入时恢复启用状态。
- **Validation**:
  - 新建映射默认启用。
  - 导入导出后启用状态不丢失。

### Stage 2: 代理与模型发现
- **Files modified**: `lib/proxy.ts`, `lib/model-catalog.ts`
- **Specific logic**:
  - 映射匹配查询仅返回启用中的映射。
  - 如模型发现逻辑会从映射推导模型，也同步跳过停用映射。
- **Validation**:
  - 停用映射后请求不再命中它。
  - 仅启用映射时行为与当前一致。

### Stage 3: 映射列表多选与启停
- **Files modified**: `components/mappings/mappings-table.tsx`
- **Specific logic**:
  - 复用 `components/models/models-table.tsx` 的选择模式：`selected`、header 全选、row checkbox、批量按钮。
  - 增加单行启用/停用按钮。
  - 批量启用/停用仅作用于选中行。
  - 筛选/搜索变化时清空选择，避免误操作。
- **Validation**:
  - 选中多条后批量启用/停用可生效。
  - 单条切换后列表刷新并保留其他状态。

## Testing Strategy
- Happy path: 创建映射，批量停用，再批量启用。
- Regression path: 现有映射创建、编辑、删除、分页、筛选保持正常。
- Negative path: 停用映射不参与路由命中。

## Risks & Mitigation
- 风险：旧数据没有 `enabled` 字段。缓解：默认值设为 `true`，并在初始化脚本中补列。
- 风险：同步/异步路径行为不一致。缓解：两条路径都使用同样的启用过滤条件。
- 风险：批量操作误触。缓解：仅在有选中项时显示可用状态，并在筛选变化时清空选择。

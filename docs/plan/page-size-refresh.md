# Page Size 切换刷新设计文档

## Background & Goals

项目的列表分页统一使用 `components/ui/list-pagination.tsx`。部分页面在第一页切换 Page Size 后没有重新请求数据，另有日志实时更新继续使用旧 Page Size。

成功标准：

- 审计全部 16 处分页组件实例。
- 用户列表切换 Page Size 后立即按新值请求。
- 日志 SSE 新增数据按当前 Page Size 截断。
- 其他已正常工作的分页页面保持不变。

## High-Level Design

共享 `ListPagination` 已负责更新 `pageSize` 并重置到第一页，无需修改。问题来自两个消费页面的 React effect 依赖不完整，因此仅补齐依赖数组：

- 用户列表加载 effect 依赖 `pageSize`。
- 日志 SSE effect 依赖其回调读取的 `pageSize`。

## Implementation Plan

### Stage 1: 分页调用点审计

- **Files reviewed**: `components/ui/list-pagination.tsx` 及全部 `ListPagination` 调用方
- **Specific logic**: 核对 Page Size 回调、请求参数、加载 effect、客户端切片和 SSE 闭包。
- **Validation**: 确认 16 处实例中仅用户列表和日志 SSE 存在缺失依赖。

### Stage 2: 用户列表刷新

- **Files modified**: `components/users/users-table.tsx`
- **Specific logic**: 将 `pageSize` 加入调用 `load()` 的 effect 依赖数组。
- **Validation**: 在第一页切换 10/20/50/100，观察 `/api/users` 每次携带新值。

### Stage 3: 日志实时流刷新

- **Files modified**: `components/logs/log-stream.tsx`
- **Specific logic**: 将 `pageSize` 加入 SSE effect 依赖数组，使 `.slice(0, pageSize)` 使用当前值。
- **Validation**: 用户和管理日志切换 Page Size 后，后续 SSE 数据按新值截断；筛选、暂停和非第一页行为不变。

### Stage 4: 回归验证

- **Files modified**: `docs/IMPLEMENTATION_PLAN.md`, `docs/plan/page-size-refresh.md`
- **Specific logic**: 更新实施状态和验证结果。
- **Validation**: 运行 `bunx tsc --noEmit`、`bun run build`、`git diff --check`，并通过运行中的应用验证相关请求和实时数据。

## Testing Strategy

- **Happy path**: 第一页切换所有 Page Size 选项后立即刷新；日志实时新增遵循新值。
- **Error/edge path**: 非第一页切换后回到第一页；筛选、排序及暂停状态不改变。
- **Regression scope**: 模型、礼品卡、审计、渠道、映射、Key、定价等服务端分页，以及模型广场、排行、用户详情等客户端分页。

## Risks & Mitigation

- `pageSize` 变化会重建日志 EventSource，这是刷新闭包值所需的最小改动；现有自动重连机制保持不变。
- 不新增分页抽象，不修改共享组件或其他已验证正常的页面。
- 回滚只需移除两处 effect 依赖；无数据或 API 契约变更。

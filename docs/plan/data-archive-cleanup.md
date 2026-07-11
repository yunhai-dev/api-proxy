# 数据归档与清理 Design Document

## Background & Goals

- 问题：请求日志、渠道测试日志、审计日志会持续增长，长期运行后数据库体积会变大。
- 目标：在设置页提供管理员手动归档与清理入口，支持先导出旧数据，再删除指定截止时间前的数据。
- 成功标准：旧数据可按类型和截止日期导出、预览数量、确认删除；默认不自动删除任何数据。

## High-Level Design

- 复用现有 `/api/export`，增加 `before` 截止时间过滤。
- 新增管理员接口 `/api/settings/archive`：`GET` 预览数量，`DELETE` 删除旧数据。
- 设置页 `logs` tab 增加归档清理区，使用原生日期输入和现有按钮/select 样式。
- 不新增表，不保存归档文件到服务器，不做定时任务。

## Implementation Plan

### Stage 1: Plan docs

- **Files modified**: `docs/IMPLEMENTATION_PLAN.md`, `docs/plan/data-archive-cleanup.md`
- **Specific logic**: 登记阶段列表和本设计文档。
- **Validation**: 文档链接可读，阶段状态随实现更新。

### Stage 2: Export cutoff

- **Files modified**: `app/api/export/route.ts`
- **Specific logic**: 解析 `before`，对 `request_logs`、`channel_test_logs`、`activities` 加 `ts < before` 过滤；保留现有权限和 CSV/JSON 输出。
- **Validation**: 带 `before` 的导出只包含旧数据；不带参数行为不变。

### Stage 3: Archive API

- **Files modified**: `app/api/settings/archive/route.ts`
- **Specific logic**: 新增 `GET` count 和 `DELETE` 清理；限制类型；要求 cutoff 至少早于当前 24 小时；删除需要 `archiveConfirmed` 和 `confirm: "DELETE"`；删除后写活动记录。
- **Validation**: 非管理员拒绝；缺确认拒绝；过近 cutoff 拒绝；成功只删旧数据。

### Stage 4: Settings UI

- **Files modified**: `components/settings/settings-form.tsx`
- **Specific logic**: 在日志导出 tab 加类型选择、截止日期、预览、归档下载、确认勾选、删除按钮。
- **Validation**: 未预览/未确认时不能删除；删除成功后提示数量并重置确认。

### Stage 5: Verification

- **Files modified**: `docs/IMPLEMENTATION_PLAN.md`
- **Specific logic**: 完成后更新阶段状态。
- **Validation**: `bunx tsc --noEmit` 通过。

## Testing Strategy

- Happy path：管理员选择日志类型和旧日期，预览数量，下载 CSV，勾选确认，删除成功。
- Error path：无确认删除、确认字符串缺失、cutoff 太近、非法类型都返回 400/403。
- Regression：原有三个 CSV 导出按钮仍可用；设置页其他 tab 保存不受影响。

## Risks & Mitigation

- 风险：误删未归档数据。
  - 缓解：需要预览、下载确认、浏览器确认和服务端确认字段；cutoff 至少早于 24 小时。
- 风险：一次删除大量数据耗时。
  - 缓解：先做手动单表清理；需要分批时再加批处理。
- 回滚：移除新增 UI 和 `/api/settings/archive`，保留 `/api/export` 原行为或去掉 `before` 过滤。
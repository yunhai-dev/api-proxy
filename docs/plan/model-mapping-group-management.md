# 模型映射分组管理设计文档

## Background & Goals

模型映射表单支持每行输入一个入站模型，但此前每行会创建一条独立管理记录，后续切换上游、渠道、状态或删除时需要逐条操作。目标是将同一次提交的多个入站模型作为一个管理组，并补充批量删除，同时不改变代理层逐行匹配路由的行为。

成功标准：
- 多行输入在管理页仅显示一组。
- 编辑、启停和删除作用于整组。
- 存量映射保持独立，不自动合并。
- 相同入站模型仍可存在于不同组，继续作为不同路由候选。
- 多选操作支持一次批量删除。

## High-Level Design

`model_mappings` 保留标量 `inbound_model`，新增 nullable `group_id`。同次多行创建在事务中写入多条物理路由并共享组 ID；管理 API 按组聚合后过滤、排序和分页。代理仍直接读取物理行，无需修改。

## Implementation Plan

### Stage 1: 数据模型
- **Files modified**: `lib/db/pg-schema.ts`, `scripts/init-postgres-schema.mjs`, `lib/db/pg-migrations/*`
- **Specific logic**: 新增 nullable `group_id` 和非唯一索引；新库、旧库升级均幂等；不回填存量记录。
- **Validation**: 全新和升级数据库重复执行初始化；确认重复入站模型仍可写入。

### Stage 2: 分组 API
- **Files modified**: `lib/model-mapping-groups.ts`, `app/api/model-mappings/route.ts`, `app/api/model-mappings/[id]/route.ts`
- **Specific logic**: 增加显式 grouped GET；多行 POST 事务创建；PATCH 协调整组别名并统一共享字段；单项和批量 DELETE 展开整组。
- **Validation**: 验证存量 singleton、多别名组、不同组同名入站、错误渠道和空输入。

### Stage 3: 管理界面
- **Files modified**: `components/mappings/mappings-table.tsx`
- **Specific logic**: 按组加载和展示；创建/编辑仅发送一次请求；行操作作用于组；批量操作增加删除确认。
- **Validation**: 页面完成创建、编辑、启停、单项删除和多选删除。

### Stage 4: 配置兼容与文档
- **Files modified**: `app/api/config/import/route.ts`, `README.md`, `docs/IMPLEMENTATION_PLAN.md`
- **Specific logic**: 原始物理行格式继续导出；导入接受可选 `groupId`；记录产品语义和升级方法。
- **Validation**: 新旧配置导入，分组导出后重导入仍保留组关系。

## Testing Strategy

- Happy path：创建三别名组，统一编辑渠道、上游和状态，单项/批量删除。
- Error path：空别名、错误服务商、错误渠道均返回 400 且不产生部分写入。
- Regression：无 `view=groups` 的 GET 与单入站 POST 保持兼容；Claude/OpenAI 代理路径继续匹配物理行。
- Commands：相关 Bun 测试、`bunx tsc --noEmit`、`bun run build`、`git diff --check`。

## Risks & Mitigation

- 误合并存量路由：null `group_id` 永远逐行成组。
- 分组分页错误：先聚合、过滤和排序，再分页并按组计算 total。
- 部分写入：PostgreSQL 的创建、编辑和删除使用事务。
- 路由语义变化：不修改代理查询，不新增 provider/inbound 唯一约束。
- 回滚：旧代码可忽略 nullable `group_id`，数据库列无需删除。

# Sub2API 账号状态 Design Document

## Background & Goals

当前控制台无法直接观察 Sub2API 上游账号状态。新增管理员只读页面，展示账号健康、分组容量、平台分类、今日用量，以及可筛选分页和查看安全详情的账号列表。

成功标准：管理员无需离开本平台即可判断 Sub2API 账号是否健康、可调度、限流或接近容量；任何浏览器响应、日志或配置导出均不包含 Sub2API 管理密钥或账号凭据。

## High-Level Design

系统设置以现有 key/value 方式保存 Sub2API Base URL 与加密管理员密钥。服务端 client 使用固定路径访问 Sub2API 管理 API，将原始响应映射为字段白名单 DTO。本地管理员 API 向页面提供状态快照、分页账号与单账号安全详情。页面每 30 秒在可见状态下自动刷新，并支持手动刷新。

## Implementation Plan

### Stage 1: 连接设置与密钥保护

- **Files modified**: `lib/settings.ts`, `app/api/settings/route.ts`, `components/settings/settings-form.tsx`, `app/api/config/export/route.ts`, `app/api/config/import/route.ts`
- **Specific logic**: 增加 URL/管理员密钥设置；复用 SMTP 密码加密和掩码行为；配置导入导出必须管理员授权且不得输出密钥。
- **Validation**: 保存、刷新和再次保存不丢失密钥；数据库仅存密文；设置与导出响应无密钥。

### Stage 2: 服务端只读边界

- **Files modified**: `lib/sub2api.ts`, `lib/sub2api.test.ts`
- **Specific logic**: 固定账号、账号详情、分组容量、Dashboard 快照路径；校验 URL/分页/筛选；15 秒超时；解析 envelope；逐字段构造状态 DTO，禁止透传凭据和未知字段。
- **Validation**: 测试 URL、固定路径、错误响应与字段白名单；注入敏感字段后断言无法出现在结果中。

### Stage 3: 管理员 API

- **Files modified**: `app/api/sub2api/status/route.ts`, `app/api/sub2api/accounts/route.ts`
- **Specific logic**: `requireAdmin` 后访问上游；状态快照返回健康/分组/平台/今日指标；账号 API 支持分页筛选和正整数 ID 详情；只导出 GET。
- **Validation**: 未配置、非法参数、错误 key、网络失败和畸形响应返回安全错误；非管理员在上游请求前被拒绝。

### Stage 4: 状态页面

- **Files modified**: `app/admin/sub2api/page.tsx`, `components/sub2api/sub2api-status-view.tsx`, `components/nav-tabs.tsx`
- **Specific logic**: 管理员独立入口；KPI、分组/平台数值表、账号筛选分页、手动刷新、页面可见时 30 秒自动刷新、按需安全详情弹窗。
- **Validation**: 桌面和窄屏操作汇总、筛选、分页、刷新和详情；快速筛选不会被旧请求覆盖；页面隐藏时暂停轮询。

## Testing Strategy

- Happy path: 有效 Sub2API 实例的状态、账号列表、筛选分页和详情与源后台一致。
- Error path: 缺少配置、错误 URL/key、非法参数、上游 500、畸形响应、超时。
- Regression scope: 系统设置保存、配置导入导出权限与脱敏、管理员导航。
- Commands: `bun test lib/sub2api.test.ts`, `bunx tsc --noEmit`, `bun run build`。

## Risks & Mitigation

- Sub2API 版本字段变化：兼容映射仅位于 `lib/sub2api.ts`，UI 使用稳定 DTO。
- 敏感数据泄漏：禁止 spread 原始对象，以注入敏感字段测试锁定白名单。
- 轮询负载：30 秒且仅页面可见时执行，账号详情按需获取。
- 回滚：删除页面/API/client/nav 和两个设置字段；无 Sub2API 写操作及业务表迁移。

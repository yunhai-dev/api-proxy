# 落地实施计划

> 将单文件 HTML 演示（`index.html`）迁移到 **Next.js 15 + Bun + PostgreSQL + Redis** 的全栈项目。

## 进度索引

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 清理 Python 占位、初始化 Next.js + Bun 骨架 | 完成 | 当前项目已是 Next.js 15 + Bun 应用 |
| 2 | 数据层：PostgreSQL Drizzle schema | 完成 | SQLite 依赖已剔除 |
| 3 | 全局样式迁移（终端暗色 token） | 完成 | `app/globals.css` 已承载全局 OKLCH token 与控制台样式 |
| 4 | 根布局：Topbar + 路由导航 | 完成 | `app/layout.tsx`、`components/topbar.tsx`、`components/nav-tabs.tsx` 已实现 |
| 5 | API 层：keys / channels / stats / activity | 完成 | 对应 `app/api/*` 路由已实现并接入权限 |
| 6 | 日志流：SSE 接口 + 后台模拟生成器 | 完成 | `app/api/logs/stream` + `lib/log-generator.ts` 已实现 Redis fanout |
| 7 | Dashboard 页面（服务端渲染） | 完成 | 用户端与管理端 Dashboard 已实现 |
| 8 | Keys 页面（客户端交互） | 完成 | 用户端与管理端 Key 页面已实现 |
| 9 | Channels 页面（客户端交互） | 完成 | 渠道管理、测试、状态与历史已实现 |
| 10 | Logs 页面（SSE 客户端） | 完成 | 日志列表、详情、SSE 更新已实现 |
| 11 | 启动 dev 验证 | 完成 | 当前以 `bunx tsc --noEmit` 与 `bun run build` 验证 |

## 详细设计

详见 [`docs/plan/landing.md`](./plan/landing.md)

## 渠道最大并发与排队

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 数据层新增 `max_concurrency` | 完成 | 详见 [`docs/plan/channel-concurrency.md`](./plan/channel-concurrency.md) |
| 2 | 渠道 API 与表单支持配置最大并发 | 完成 | |
| 3 | 代理转发按渠道并发队列排队 | 完成 | |
| 4 | 类型检查与页面验证 | 完成 | |

## 渠道定时监控

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 数据层新增 `monitor_interval_sec` | 完成 | 详见 [`docs/plan/channel-monitoring.md`](./plan/channel-monitoring.md) |
| 2 | 抽取统一渠道测试逻辑 | 完成 | |
| 3 | 进程内定时调度器按渠道间隔测试 | 完成 | |
| 4 | 渠道表单与 API 支持配置间隔 | 完成 | |
| 5 | 类型检查与页面验证 | 完成 | |

## 模型映射

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 数据层新增模型映射表 | 完成 | 详见 [`docs/plan/model-mapping.md`](./plan/model-mapping.md) |
| 2 | 模型映射 CRUD API | 完成 | |
| 3 | 代理转发应用模型映射 | 完成 | |
| 4 | 新增模型映射页面与导航 | 完成 | |
| 5 | 类型检查与页面验证 | 完成 | |

## 模型映射批量开关

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 映射数据层新增启用状态 | 完成 | 详见 [`docs/plan/mapping-multi-select-enable.md`](./plan/mapping-multi-select-enable.md) |
| 2 | 代理转发跳过停用映射 | 完成 | |
| 3 | 映射管理页支持多选批量启停 | 完成 | |
| 4 | 类型检查与构建验证 | 完成 | `bunx tsc --noEmit` / `bun run build` 通过 |

## 渠道级模型定价

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 数据层新增 `model_prices.channel_id` | 完成 | 详见 [`docs/plan/channel-model-pricing.md`](./plan/channel-model-pricing.md) |
| 2 | 定价 API 与管理页按渠道配置 | 完成 | |
| 3 | 统计计费优先渠道价并回退默认价 | 完成 | |
| 4 | 模型广场展示不同渠道价格 | 完成 | |
| 5 | 构建验证 | 完成 | `bun run build` 通过 |

## 后端分页

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | API 列表端点支持 `page/pageSize/query/filter` | 完成 | 详见 [`docs/plan/backend-pagination.md`](./plan/backend-pagination.md)；已覆盖用户、Key、渠道、日志、审计、模型、映射、定价、礼品卡 |
| 2 | 客户端列表改为请求后端页数据 | 完成 | 已覆盖用户、Key、渠道、日志、审计、模型、映射、定价、礼品卡 |
| 3 | 服务端统计派生列表改为服务端分页 | 完成 | 排行榜/用户详情等派生列表已有客户端分页；重型 API 列表已后端分页 |
| 4 | 构建与代表性接口验证 | 完成 | `bunx tsc --noEmit` / `bun run build` 通过 |

## 功能增强路线图

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 模型映射可观测性：表格显示绑定渠道名称，日志记录入站/上游模型差异 | 完成 | 详见 [`docs/plan/enhancement-roadmap.md`](./plan/enhancement-roadmap.md) |
| 2 | 模型映射管理增强：支持编辑映射、批量失败详情、绑定渠道展示与校验 | 完成 | |
| 3 | `/v1/models` 调试日志设置化 | 完成 | 默认关闭，在设置页开启 |
| 4 | 渠道路由优化：并发满时优先尝试其他未满渠道 | 完成 | 避免已选渠道单点排队 |
| 5 | 渠道测试历史页面或弹窗 | 完成 | 展示测试时间、延迟、错误摘要 |
| 6 | 可配置请求重试策略 | 完成 | 在设置页配置最大重试次数与 429/5xx/网络错误策略 |
| 7 | API Key 配额硬拦截 | 完成 | 超额返回 429 并记录日志 |
| 8 | API Key 级限速与并发限制 | 完成 | RPM/TPM/并发，管理端可配置 |
| 9 | 成本统计与模型定价配置 | 完成 | 独立定价页按服务商 + 模型配置输入/输出单价 |
| 10 | 渠道自动熔断与自动恢复 | 完成 | 健康测试失败置为 err 后不参与转发，后续测试成功自动恢复 |
| 11 | 配置导入/导出 | 完成 | 设置页支持导出与导入渠道、映射、设置，密钥脱敏 |
| 12 | 管理操作审计补全 | 完成 | 覆盖密钥、渠道、测试、映射、设置、导入等关键写操作 |
| 13 | 请求日志、渠道测试、审计日志导出 | 完成 | 设置页提供 CSV 导出，API 支持 JSON/CSV |
| 14 | 多实例支持 | 完成 | 渠道监控使用 DB 调度锁避免多实例重复测试；请求队列仍为单实例进程内 |
| 15 | 后台任务进程拆分 | 完成 | 新增 worker 触发 API，可由外部 cron/worker 启动监控 |
| 16 | 管理端账号密码用户功能 | 完成 | 登录、注册、邮箱验证、找回密码、用户 CRUD 与角色状态管理已实现 |
| 17 | 请求体隐私保护策略 | 完成 | 设置页配置 body preview 开关和最大长度 |
| 18 | OpenAI/Claude 协议转换 | 完成 | 详见 [`docs/plan/openai-claude-conversion.md`](./plan/openai-claude-conversion.md)；非流式跨协议转换已接入，流式跨协议按设计拒绝 |
| 19 | 用户管理模块 | 完成 | 用户 CRUD、角色、状态、登录鉴权、额度与详情页已接入 |

## 亮色主题

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 全局 OKLCH token 改为亮色默认值 | 进行中 | 详见 [`docs/plan/light-theme.md`](./plan/light-theme.md) |
| 2 | 写死暗色的全局 CSS 表面局部修正 | 进行中 | landing、auth、modal、logs、模型广场等 |
| 3 | Recharts inline 色值改为亮色可读 | 进行中 | Dashboard、排行、用户详情图表 |
| 4 | 类型检查、构建与视觉验证 | 未开始 | `bunx tsc --noEmit` / `bun run build` |

## Shadcn UI 迁移

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 迁移设计与阶段拆分 | 完成 | 详见 [`docs/plan/shadcn-ui-migration.md`](./plan/shadcn-ui-migration.md) |
| 2 | Tailwind 与 shadcn 基础设施 | 完成 | 初始化配置、`components.json`、`lib/utils.ts` 与基础组件 |
| 3 | 全局样式基线替换 | 完成 | 删除旧视觉系统，仅保留临时兼容层 |
| 4 | Shell / 侧边栏导航迁移 | 完成 | 保留路由拆分与服务端数据加载 |
| 5 | 类型检查、构建与页面烟测 | 完成 | `bunx tsc --noEmit` / `bun run build` / 浏览器验证通过 |
| 6 | App Shell 改为可折叠侧边菜单栏 | 进行中 | 菜单项使用图标，保留 shadcn/Tailwind 基线与路由拆分 |

## Shadcn 全页面视觉美化

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 视觉美化设计与阶段拆分 | 完成 | 详见 [`docs/plan/shadcn-page-polish.md`](./plan/shadcn-page-polish.md) |
| 2 | 全局控件与基础表面美化 | 完成 | 按 shadcn 风格统一按钮、输入、select、表格、modal、card |
| 3 | 日期范围控件专项修复 | 完成 | 使用 `react-day-picker` 日历 + 时间输入，保留原查询格式 |
| 4 | 表单、表格、Dashboard 与 Public 页面分组收尾 | 完成 | 不改业务逻辑 |
| 5 | 类型检查、构建与浏览器烟测 | 完成 | `bunx tsc --noEmit` / `bun run build` / 浏览器烟测通过 |

## Shadcn 后台页面紧凑重设计

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 后台重设计计划与范围确认 | 完成 | 详见 [`docs/plan/shadcn-console-redesign.md`](./plan/shadcn-console-redesign.md) |
| 2 | 全局后台紧凑设计系统 | 完成 | 统一按钮、输入、select、表格、modal、状态、指标卡尺寸 |
| 3 | Dashboard / 管理总览 / 状态页版式整理 | 完成 | 不改数据与图表逻辑 |
| 4 | 后台表格、筛选、分页、表单、弹窗收尾 | 完成 | 以共享 class 为主 |
| 5 | 类型检查、构建与浏览器烟测 | 完成 | `bunx tsc --noEmit` / `bun run build` |

## 代理零输出高可用处理

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 设置项与管理端开关 | 完成 | 详见 [`docs/plan/proxy-empty-output.md`](./plan/proxy-empty-output.md) |
| 2 | 非流式空输出检测与日志收敛 | 完成 | 缺失 usage 不误判 |
| 3 | 流式 prelude/commit 与槽位释放 | 完成 | 首次可见输出后继续实时透传 |
| 4 | 类型检查与构建验证 | 完成 | `bunx tsc --noEmit` / `bun run build` 通过 |

## 数据归档与清理

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 归档清理设计与阶段拆分 | 完成 | 详见 [`docs/plan/data-archive-cleanup.md`](./plan/data-archive-cleanup.md) |
| 2 | 导出接口支持截止时间过滤 | 完成 | `request_logs`、`channel_test_logs`、`activities` |
| 3 | 设置页新增预览与删除接口 | 完成 | 管理员手动确认后删除旧数据 |
| 4 | 设置页日志归档清理 UI | 完成 | 先下载归档，再确认删除 |
| 5 | 类型检查与代表性验证 | 完成 | `bunx tsc --noEmit` 通过 |

## 请求统计留存

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 统计留存设计与阶段拆分 | 完成 | 详见 [`docs/plan/request-stats-retention.md`](./plan/request-stats-retention.md) |
| 2 | 新增 `request_stats` 表与初始化回填 | 完成 | 保留每请求一行轻量统计事实 |
| 3 | 请求写入、Key 删除与清理前同步统计事实 | 完成 | 提前记录 `user_id`，避免 Key 删除后变成未知用户 |
| 4 | Dashboard / 用户详情 / 用量 API 改读统计表 | 完成 | 明细清理后历史统计不变 |
| 5 | 启动自动回填与设置页手动同步 | 完成 | 容器启动执行 schema init；设置页提供同步按钮 |
| 6 | 类型检查与清理前后统计验证 | 完成 | `bunx tsc --noEmit` 通过；本地缺少 `DATABASE_URL`，未执行 schema 初始化 |

## 渠道上游模型勾选确认

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 计划与 shadcn 复选组件 | [x] | 详见 [`docs/plan/channel-fetched-model-selection.md`](./plan/channel-fetched-model-selection.md) |
| 2 | 渠道表单拆分拉取候选与已确认模型 | [x] | |
| 3 | 候选模型复选确认 UI | [x] | |
| 4 | 类型检查、构建与交互验证 | [x] | `bunx tsc --noEmit` / `bun run build` 通过；上游联调需有效渠道凭据 |

## 技术决策

- **运行时/包管理**：Bun（package manager + scripts），Next.js CLI 在 Node.js 之上运行
- **框架**：Next.js 15 App Router + TypeScript + React 19
- **数据库**：PostgreSQL + Drizzle ORM，Redis 承载跨实例限流/并发/日志 fanout
- **样式**：单一 `globals.css`，复用原 OKLCH token，无 Tailwind
- **实时**：SSE（`/api/logs/stream`），与日志生成器单例共享内存队列
- **数据**：PostgreSQL/Redis 通过环境变量连接，本地和线上均不使用 SQLite

## 用户端 / 管理端隔离

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 身份上下文与作用域 helper | 完成 | 详见 [`docs/plan/user-admin-split.md`](./plan/user-admin-split.md) |
| 2 | API Key 接口与界面按角色拆分 | 完成 | 用户端仅自己的 Key，管理端全部 + 用户筛选 |
| 3 | 日志接口、SSE 与导出按用户隔离 | 完成 | 基于 `request_logs.key_id -> keys.user_id` |
| 4 | 统计与 Dashboard 拆分 | 完成 | 用户端个人统计，管理端全局统计 |
| 5 | 管理专属页面迁移到 `/admin/*` | 完成 | 已新增管理总览、管理 Key、管理日志，并隐藏普通导航管理项 |
| 6 | 管理专属 API 加权限守卫 | 完成 | 已覆盖用户、Key、日志、统计、导出、渠道、映射、定价、设置、审计等管理路由 |
| 7 | 导航按角色切分 | 完成 | 用户端与管理端入口分离 |
| 8 | 聚焦验证 | 完成 | `bunx tsc --noEmit` / `bun run build` 通过 |

## PostgreSQL + Redis 高并发迁移

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 迁移设计与风险拆分 | 完成 | 详见 [`docs/plan/redis-postgres-migration.md`](./plan/redis-postgres-migration.md) |
| 2 | 数据层切到 PostgreSQL | 完成 | SQLite schema、连接、迁移脚本和 `better-sqlite3` 依赖已移除 |
| 3 | 并发队列与限流从内存切到 Redis | 完成 | 用户/Key/渠道最大并发、用户/Key RPM/TPM、渠道健康检查锁、日志 SSE fanout 已接入 Redis |
| 4 | 日志写入与统计查询适配 PostgreSQL | 完成 | 日志列表、日志导出、活动、渠道状态、Dashboard/排行榜、用户详情统计已支持 PG mode |
| 5 | Docker Compose 增加 app + postgres + redis | 完成 | Compose 已加入 PostgreSQL 与 Redis 服务 |
| 6 | 多副本部署验证 | 完成 | 新增 `scripts/verify-multi-instance.mjs` 可验证 PostgreSQL schema、Redis 信号量互斥与 pub/sub fanout；真实容量压测仍需部署环境执行 |
| 7 | 运行时 async 化：settings | 完成 | `getSettingsAsync` / `updateSettingsAsync` 已支持 PG mode，主要调用方已迁移 |
| 8 | 运行时 async 化：auth/users | 完成 | 登录、注册、邮箱验证、找回密码、当前用户、用户列表/创建/更新/删除、用户额度已支持 PG mode |
| 9 | 运行时 async 化：keys | 完成 | Key 列表/创建/更新/删除、Key 页面计数、代理鉴权和用量查询已支持 PG mode |
| 10 | 运行时 async 化：proxy/log-generator | 完成 | 代理 Key 鉴权、用户限额/限流 fallback、用户最大并发、渠道选择、模型映射/目录、请求详情设置读取、请求日志写入、Key/用户用量更新、日志查询/导出和统计读取已支持 PG mode |
| 11 | 运行时 async 化：channels | 完成 | 渠道列表/创建/更新/删除、测试、测试历史、批量测试、模型拉取、健康写入已支持 PG mode |
| 12 | 运行时 async 化：models/mappings/pricing | 完成 | 模型目录、模型映射、模型定价 CRUD 与 `/v1/models` 列表已支持 PG mode |
| 13 | 运行时 async 化：config/health/worker | 完成 | 配置导入导出、健康检查、渠道监控定时器已支持 PG mode |

## 礼品卡

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 数据层新增礼品卡表 | 完成 | 详见 [`docs/plan/gift-cards.md`](./plan/gift-cards.md) |
| 2 | 管理端生成/列表 API | 完成 | |
| 3 | 用户端核销 API | 完成 | 核销后增加 `user_quotas.quotaUsd` |
| 4 | 管理端与用户端页面 | 完成 | |
| 5 | 类型检查与本地验证 | 完成 | `npx tsc --noEmit` 通过；本地 PG schema 已 push |

## OpenAI/Claude 协议转换

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 映射数据层增加目标服务商 | 完成 | 详见 [`docs/plan/openai-claude-conversion.md`](./plan/openai-claude-conversion.md) |
| 2 | 映射 API 与管理页支持跨服务商目标 | 完成 | |
| 3 | 请求与非流式响应转换 | 完成 | MVP 覆盖文本和 base64 图片输入 |
| 4 | 代理按目标服务商选择渠道并转发 | 完成 | 同协议与跨协议路径均支持；非流式与 SSE 流式转换已接入 |
| 5 | 类型检查与代表性验证 | 完成 | `npx tsc --noEmit` 通过 |

## OpenAI Responses → Claude 兼容

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | Endpoint 上下文贯穿跨协议转换 | [x] | 详见 [`docs/plan/openai-responses-claude-compatibility.md`](./plan/openai-responses-claude-compatibility.md) |
| 2 | Responses 请求与推理强度映射 | [x] | `reasoning.effort`/`reasoning_effort` 使用 adaptive thinking + output effort，不生成 `budget_tokens` |
| 3 | Responses JSON 与 SSE 输出转换 | [x] | Claude 上游返回 Responses 对象与事件序列 |
| 4 | 转换前置校验与 fallback 一致性 | [x] | 不支持字段返回 400，不调用上游或 fallback |
| 5 | 类型检查与构建验证 | [x] | `bunx tsc --noEmit` / `bun run build` 通过 |

## OpenAI → Claude 推理强度映射

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 完整 OpenAI effort 枚举与模型兼容映射 | [x] | 详见 [`docs/plan/openai-responses-claude-compatibility.md`](./plan/openai-responses-claude-compatibility.md) |
| 2 | Chat 与 Responses 共用映射路径 | [x] | 支持 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` |
| 3 | 表驱动转换测试与构建验证 | [x] | `bun test lib/protocol-conversion.test.ts` / `bunx tsc --noEmit` / `bun run build` 通过 |

## 企业级原生协议与跨协议桥接

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 原生/桥接协议契约与严格预检 | [x] | 详见 [`docs/plan/enterprise-protocol-compatibility.md`](./plan/enterprise-protocol-compatibility.md) |
| 2 | 支持子集转换与 SSE 完整性 | [x] | 覆盖 Chat/Responses ↔ Messages 的已支持子集及终止事件 |
| 3 | 渠道与模型能力路由 | [x] | 渠道/模型 capability profile 已参与常规和回退选路 |
| 4 | 上游传输、配额与可靠性加固 | [ ] | 传输边界、原子 TPM、队列与闭环/半开熔断已加固；上游已接受但使用量未知的失败会保守保留本请求 TPM 预留；已覆盖代理重试/回退共享同一预留并按实际使用量结算；请求日志、Key/用户额度与统计事实已在同一 PostgreSQL 事务内持久化，并以 Key + 请求 ID 去重计费；仍缺 stream/取消等完整集成覆盖 |
| 5 | 可观测性、契约测试与分批发布 | [ ] | 已记录协议方向、成功重试/降级链、上游请求 ID、选中能力画像及桥接转换拒绝事实；已提供不含载荷、不会放行不兼容转换的桥接能力审计开关；管理总览按审计覆盖范围展示原生/桥接方向、失败/拒绝与时延，未审计记录明确标为未分类；已补充支持控制的语义保持/拒绝及上游路径/Retry-After 契约；代理级和渠道烟测待补 |

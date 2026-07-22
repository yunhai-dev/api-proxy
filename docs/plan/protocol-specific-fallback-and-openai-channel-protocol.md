# 协议独立 Fallback 与渠道上游协议 Design Document

## Background & Goals

- 当前 Claude 与 OpenAI 入站请求共用一组 Fallback，无法独立指定备用渠道和模型。
- OpenAI 渠道无法固定使用 Chat Completions 或 Responses；普通请求与渠道测试也无法表达这一差异。
- 成功标准：按入站协议独立降级；每个 OpenAI 渠道支持自动、Chat Completions、Responses；普通路由、Fallback、单次/批量/定时测试行为一致；旧配置和旧渠道默认行为不变。

## High-Level Design

Fallback 在现有 `settings` 键值表中拆成 Claude/OpenAI 两组三元组，代理按 `req.type` 原子选择。旧全局键只作为缺少新键时的读取兼容值。

渠道表增加 `openai_protocol = auto | chat_completions | responses`。代理分别保留客户端入站 OpenAI endpoint 与渠道实际上游 endpoint，再以这对协议决定请求、JSON 响应和 SSE 转换。Embeddings 始终使用 `/v1/embeddings`，不受渠道文本协议配置影响。

协议矩阵：

- Claude → OpenAI auto/chat：Chat Completions；Claude → OpenAI responses：Responses。
- OpenAI Chat auto/chat：Chat；forced responses：Responses。
- OpenAI Responses auto/responses：Responses；forced chat：Chat。
- OpenAI Embeddings：始终 Embeddings。

## Implementation Plan

### Stage 1: Fallback 设置与兼容读取
- **Files modified**: `lib/settings.ts`, `app/api/settings/route.ts`, `components/settings/settings-form.tsx`, `app/api/config/import/route.ts`
- **Specific logic**: 增加两组六字段；新键存在时优先使用，缺失时逐字段继承旧全局键；界面分两组编辑；旧导入补全新键。
- **Validation**: 旧配置同时驱动两组；显式 `false` 和空字符串不被旧值覆盖；两组保存后互不影响。

### Stage 2: 渠道协议数据与管理界面
- **Files modified**: `lib/db/pg-schema.ts`, `scripts/init-postgres-schema.mjs`, `app/api/channels/route.ts`, `app/api/channels/[id]/route.ts`, `app/api/config/import/route.ts`, `components/channels/channel-form.tsx`, `components/channels/channels-table.tsx`
- **Specific logic**: 新增默认 `auto` 的 `openai_protocol`；启动初始化兼容旧库；CRUD 校验枚举；旧导入归一化；OpenAI 渠道表单和列表展示协议。
- **Validation**: 旧渠道自动为 `auto`；非法 API 值返回 400；Claude 渠道不应用此设置。

### Stage 3: 上游 endpoint 解析与 Fallback 分流
- **Files modified**: `lib/upstream.ts`, `lib/proxy.ts`, `lib/protocol-capabilities.ts`
- **Specific logic**: 共享解析实际上游 endpoint；路由上下文区分入站与上游 endpoint；普通及 Fallback 使用同一路径；按 `req.type` 选择对应 Fallback；能力判断使用实际上游协议。
- **Validation**: 自动模式保持现状；强制协议命中正确 URL；Embeddings 不可被覆盖且不允许 Claude Fallback。

### Stage 4: Chat 与 Responses 双向转换
- **Files modified**: `lib/protocol-conversion.ts`, `lib/proxy.ts`
- **Specific logic**: 在现有 Claude 桥接基础上增加 Chat ↔ Responses 请求、JSON 响应和 SSE 转换；相同 provider 且相同 endpoint 才透传；无法无损转换的字段前置拒绝。
- **Validation**: 文本、图片、工具调用/结果、reasoning、usage、结束事件和任意 SSE 分块保持客户端入站契约；Embeddings 透传。

### Stage 5: 渠道测试遵守协议
- **Files modified**: `lib/channel-health.ts`
- **Specific logic**: `pingChannel` 复用 endpoint 解析；Responses 渠道使用 `/v1/responses` 和 Responses 请求体，auto/chat 使用 Chat 请求体，Claude 保持 Messages。
- **Validation**: 单次、批量和定时监控共用 `pingChannel`，URL 与请求体均符合渠道设置。

### Stage 6: 自动化与发布验证
- **Files modified**: `lib/settings.test.ts`, `lib/protocol-conversion.test.ts`, `lib/protocol-capabilities.test.ts`, `lib/proxy-lifecycle.test.ts`, `lib/channel-health.test.ts`
- **Specific logic**: 覆盖兼容读取、协议矩阵、Fallback 隔离、转换、能力负路径及健康测试。
- **Validation**: 聚焦 Bun 测试、`bunx tsc --noEmit`、`bun run build`、`git diff --check`。

## Testing Strategy

- Happy path: 两类入站分别命中自己的 Fallback；每种渠道协议在普通、Fallback 和健康检查路径请求正确端点；Chat/Responses 客户端收到原协议响应。
- Error path: 非法枚举拒绝；不支持或有损转换在请求上游前返回 400；缺少跨 endpoint 能力时不选路；Embeddings + Claude Fallback 不发送请求。
- Regression scope: 原生 Claude/OpenAI 路由、跨 provider 映射、重试与熔断、TPM/并发槽释放、配置导入导出、渠道单测/批测/监控。

## Risks & Mitigation

- Chat 与 Responses SSE 生命周期不同，转换遗漏会导致客户端挂起；沿用现有有状态 SSE 解析器并覆盖终止、usage、工具参数分块。
- 混淆入站和上游 endpoint 会返回错误协议；在路由和响应上下文中使用两个明确字段，禁止覆盖入站值。
- 旧全局 Fallback 行可能残留；使用 presence-aware 新键优先规则，不删除旧行，回滚仍可读取旧值。
- 新渠道列影响旧数据库；运行时初始化使用 `ADD COLUMN IF NOT EXISTS ... DEFAULT 'auto'`，回滚时该列可安全保留。

# 服务商计费倍率 Design Document

## Background & Goals

- 当前所有已定价请求只应用一个全局计费倍率，无法分别调整 Claude 与 OpenAI 的计费。
- 增加两个服务商倍率，并与现有全局倍率相乘：`基础费用 × 全局倍率 × 服务商倍率`。
- 两个新倍率默认均为 `1`，允许设置为 `0`。
- 成功标准是额度扣减、日志费用、仪表盘统计和用户统计使用同一公式。

## High-Level Design

服务商沿用现有固定协议类型 `claude | openai`。两个倍率作为普通标量存入现有 `settings` 键值表，不增加数据库结构。模型价格解析仍先匹配渠道价格，再匹配服务商默认价格；解析出的基础费用统一交给纯函数叠加全局和服务商倍率。

请求计费时的结果继续累计到用户额度；历史日志和统计继续按当前价格与当前倍率即时计算，不增加单请求费用快照或历史回填。

## Implementation Plan

### Stage 1: 设置与管理接口
- **Files modified**: `lib/settings.ts`, `app/api/settings/route.ts`
- **Specific logic**: 增加 Claude 与 OpenAI 计费倍率，默认值为 1，复用现有非负数解析和 PATCH 更新路径。
- **Validation**: 缺失设置回退到 1；小数和 0 可保存；负值归零。

### Stage 2: 统一倍率计算
- **Files modified**: `lib/billing.ts`, `lib/log-generator.ts`, `lib/stats.ts`, `lib/user-stats.ts`
- **Specific logic**: 使用一个纯函数实现 `基础费用 × 全局倍率 × 对应服务商倍率`，接入额度扣减及全部费用展示路径。
- **Validation**: 相同基础费用在不同服务商倍率下产生不同结果，且每个倍率只应用一次。

### Stage 3: 管理界面
- **Files modified**: `components/settings/settings-form.tsx`
- **Specific logic**: 在默认用户限制页签的全局倍率旁增加 Claude 与 OpenAI 倍率输入，并说明组合公式及 0 的含义。
- **Validation**: 保存后刷新仍显示原值，现有全局倍率行为不变。

### Stage 4: 测试与发布检查
- **Files modified**: `lib/billing.test.ts`
- **Specific logic**: 覆盖默认倍率、组合计算、服务商差异、服务商为 0 和全局为 0。
- **Validation**: 聚焦 Bun 测试、TypeScript 类型检查、生产构建和 diff whitespace 检查通过。

## Testing Strategy

- Happy path: 全局倍率与两个服务商倍率均为正数，Claude/OpenAI 分别按对应组合倍率计费。
- Error path: 设置缺失或存储值非法时回退默认值；负值归零；任一适用倍率为 0 时费用为 0。
- Regression scope: 模型价格的渠道优先级、缓存 Token 计价、请求幂等扣费、仪表盘与日志统计、配置导入导出。

## Risks & Mitigation

- 三条费用路径遗漏倍率会造成扣费与展示不一致；使用共享纯函数统一最终倍率组合，并增加精确乘法测试。
- 修改倍率会立即重算历史展示费用，但不会重算已累计额度；保持现有全局倍率语义并在界面说明当前倍率作用。
- 设置使用通用键值表，无需 schema migration；回滚时移除新字段和调用，新设置行可安全保留。

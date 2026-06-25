# 亮色主题 Design Document

## Background & Goals

- 当前项目默认是终端暗色视觉，主色与大部分组件集中在 `app/globals.css` 的 OKLCH token 中。
- 目标是实现默认亮色主题，让控制台、管理页、表格、表单、图表和弹窗在日间浏览环境中更易读。
- 成功标准：不引入主题切换、不迁移样式框架，复用现有 CSS token 体系完成亮色默认外观。

## High-Level Design

- 全局 token 仍由 `app/globals.css` 的 `:root` 提供。
- 已经使用 `var(--bg)`、`var(--text)`、`var(--line)` 的组件自动继承亮色。
- 对仍写死暗色的全局 CSS 表面做局部替换。
- Recharts 组件中的 inline 色值无法自动继承 CSS token，逐个改成亮色可读的 OKLCH literal。

## Implementation Plan

### Stage 1: 计划文档

- **Files modified**: `docs/IMPLEMENTATION_PLAN.md`, `docs/plan/light-theme.md`
- **Specific logic**: 在实施索引追加亮色主题任务列表，并创建本文档。
- **Validation**: 文档链接存在，阶段与实际实现范围一致。

### Stage 2: 全局 token 改为亮色

- **Files modified**: `app/globals.css`
- **Specific logic**: 将 `:root` 的暗色 token 替换为暖调亮色 token，补齐已被使用但缺失的 `--bg-0`，加入 `color-scheme: light`。
- **Validation**: 页面主体、导航、表格、基础表单、卡片使用亮色背景和深色文字。

### Stage 3: 修正写死暗色的 CSS 表面

- **Files modified**: `app/globals.css`
- **Specific logic**: 只替换可见暗色表面：landing、模型广场、模型详情、auth、modal、toast、log、health、select/combo、docs tab 等区域的背景、边框、阴影和 hover 色。
- **Validation**: 代表性页面无白底浅字、深色块残留不影响整体亮色主题。

### Stage 4: 修正图表 inline 色值

- **Files modified**: `components/dashboard/model-usage-bar-chart.tsx`, `components/dashboard/throughput-chart.tsx`, `components/dashboard/channel-traffic-chart.tsx`, `components/dashboard/user-token-trend-chart.tsx`, `components/rankings/top-ranking-bar-chart.tsx`, `components/users/user-token-chart.tsx`
- **Specific logic**: 将 Recharts 的 grid、axis、tooltip、cursor、pie stroke 等暗色 literal 改为亮色可读值。
- **Validation**: 图表网格、坐标轴、tooltip 和 hover cursor 在亮色背景下清晰可读。

## Testing Strategy

- Happy path tests:
  - `bunx tsc --noEmit`
  - `bun run build`
  - 本地启动后检查 `/`、`/login`、控制台 Dashboard、Logs、Rankings、模型相关页面。
- Error path tests:
  - 检查错误 toast、登录错误提示、日志错误详情和确认弹窗在亮色下仍可读。
- Regression scope:
  - 导航、表格、筛选、select/combo、modal、chart tooltip、日志列表。

## Risks & Mitigation

- 写死暗色较多，可能有漏改表面：优先修正主路径和可见组件，后续按视觉检查补小范围 CSS。
- 图表色值分散在多个 TSX 文件：逐文件替换重复的 grid/axis/tooltip 角色色。
- 不实现运行时主题切换，回滚简单：恢复 `app/globals.css` token 与局部色值即可。

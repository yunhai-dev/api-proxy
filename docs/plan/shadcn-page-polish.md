# Shadcn 全页面视觉美化设计文档

## Background & Goals

- Problem to solve: 当前页面虽然已切到 Tailwind/shadcn 基线，但大量页面仍依赖粗糙的全局兼容样式；日期范围筛选尤其显得过大、原生感重、不统一。
- Success criteria:
  - 全局按钮、输入、select、table、modal、section/card 统一为更紧凑的 shadcn 风格。
  - 日期范围控件改为更紧凑的日历选择器，仍保留原 `YYYY-MM-DDTHH:mm` 查询格式。
  - 关键表单页、列表页、Dashboard、Auth/Public 页面完成一轮视觉统一。
  - 不改业务逻辑、权限、数据请求、图表数据、proxy 行为。
  - 不触碰 `lib/proxy.ts`。

## High-Level Design

优先改共享样式和高复用组件，避免逐页重写。`app/globals.css` 是主要设计系统入口；`components/dashboard/range-form.tsx` 继续作为日期范围入口，内部复用 `components/dashboard/date-time-picker.tsx` 的 `react-day-picker` 日历弹层，并保持原查询字符串格式兼容。

## Implementation Plan

### Stage 1: 规划文档
- **Files modified**: `docs/IMPLEMENTATION_PLAN.md`, `docs/plan/shadcn-page-polish.md`
- **Specific logic**:
  - 在实施计划中新增本轮页面美化任务。
  - 记录阶段：全局控件、日期范围、表单、表格、Dashboard、Auth/Public、验证。
  - 明确 `lib/proxy.ts` 排除范围。
- **Validation**:
  - 文档可读且阶段可逐项更新状态。

### Stage 2: 全局控件与基础表面
- **Files modified**: `app/globals.css`, optionally `components/ui/input.tsx`, `components/ui/select.tsx`
- **Specific logic**:
  - 统一 `.btn`、`.ui-input`、`.field input/select/textarea` 的高度、radius、border、focus ring、disabled 状态。
  - 统一 `.select-trigger`、`.select-menu`、`.select-item` 的 popover 风格。
  - 优化 `.section`、`.settings-card`、`.modal`、`.toast`、`.table-wrap` 的边框、阴影、间距。
- **Validation**:
  - `bunx tsc --noEmit`
  - 浏览器检查任意表单/列表页面控件状态。

### Stage 3: 日期范围控件
- **Files modified**: `components/dashboard/range-form.tsx`, `components/dashboard/date-time-picker.tsx`, `app/globals.css`, `package.json`, `bun.lock`
- **Specific logic**:
  - 保留 `datetime-local` query 字符串格式，但 UI 改为 `react-day-picker` 日历 + 原生 time 输入组合。
  - 不自研 calendar；不引入 Radix Popover。
  - 开始/结束输入复用 `.ui-input mono range-input`。
  - `.range-form` 调整为紧凑 toolbar；预设按钮变为小号 ghost chips；label 更轻；移动端可换行。
- **Validation**:
  - `/dashboard`, `/admin/dashboard`, `/admin/channel-status`, `/users/[id]` 日期控件显示紧凑，提交 query 行为不变。

### Stage 4: 表单密集页面
- **Files modified**: `app/globals.css`, representative form components under `components/settings`, `components/channels`, `components/keys`, `components/gift-cards`
- **Specific logic**:
  - 通过 `.settings-card`、`.field`、`.field-row`、`.inline-form`、`.toggle-label` 和 modal class 提升一致性。
  - 只清理明显影响视觉的 inline spacing/width，不重写状态逻辑。
- **Validation**:
  - 设置页、渠道弹窗、Key 创建弹窗、礼品卡页面可打开、输入、关闭。

### Stage 5: 表格、日志、列表页面
- **Files modified**: `app/globals.css`, representative table/log components as needed
- **Specific logic**:
  - 优化 `.table-wrap`, `.table th/td`, `.sort-button`, `.empty`, `.list-toolbar`, `.filterbar`, `.list-pagination`。
  - 日志保留信息密度和 mono 风格，但降低边框/hover 的粗糙感。
- **Validation**:
  - `/keys`, `/channels`, `/logs`, `/admin/logs`, `/users`, `/mappings`, `/pricing`, `/audit` 加载和筛选正常。

### Stage 6: Dashboard / 图表 / 指标卡片
- **Files modified**: `app/globals.css`, dashboard pages/components only where necessary
- **Specific logic**:
  - 优化 `.stat-strip`, `.stat`, `.perf-card`, `.channel-health-card` 和图表容器。
  - 清理明显 inline `marginTop` 为一致 spacing class（只在必要处）。
- **Validation**:
  - Dashboard、管理总览、渠道状态、用户详情桌面/移动布局正常。

### Stage 7: Auth 与 Public 轻量收尾
- **Files modified**: `app/globals.css`, auth/public components only where necessary
- **Specific logic**:
  - 统一 auth card、landing/model/docs card、按钮、输入、间距。
  - 不重做营销页设计。
- **Validation**:
  - `/`, `/login`, `/register`, `/docs`, `/model-square` 正常显示。

## Testing Strategy

- Automated:
  - `bunx tsc --noEmit`
  - `bun run build`
- Runtime smoke:
  - `/`, `/login`, `/dashboard`, `/admin/dashboard`, `/admin/channel-status`, `/keys`, `/channels`, `/logs`, `/admin/logs`, `/settings`, `/gift-cards`, `/console/docs`
- Regression scope:
  - 日期范围 query 提交。
  - Select/filter/table pagination/sort 保持可用。
  - Modal 打开/关闭行为保持可用。
  - 侧边栏折叠和 route split 不回退。

## Risks & Mitigation

- Risk: 全局 CSS 改动影响大量页面。
  - Mitigation: 先改共享 class，不改业务逻辑；每阶段跑类型检查并浏览器烟测。
- Risk: 日期控件仍受浏览器原生 UI 限制。
  - Mitigation: 先用紧凑 wrapper + `.ui-input`；只有原生控件无法满足需求时再考虑 date picker。
- Risk: 页面过度留白降低后台信息密度。
  - Mitigation: 保持 32px 控件和紧凑 table rhythm。
- Risk: 误触 backend/proxy。
  - Mitigation: 不编辑 `lib/proxy.ts`，提交前检查 diff。

## Rollback Plan

本轮按 docs、全局控件、日期控件、页面分组分段提交；出现问题时回退对应段落即可。
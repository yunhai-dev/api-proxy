# Shadcn 后台页面紧凑重设计文档

## Background & Goals

- Problem to solve: 后台/控制台页面仍有局部样式不统一，Dashboard、表格、表单、弹窗的尺寸节奏不够一致；用户希望每个后台页面都按统一 UI 风格重新整理，并保持紧凑。
- Success criteria:
  - 后台按钮、输入、select、表格、modal、状态标签、指标卡尺寸统一。
  - Dashboard、管理总览、渠道状态页整体版式更像紧凑运营控制台。
  - 列表页、设置页、弹窗保持统一 shadcn 风格。
  - 不改业务逻辑、权限、数据请求、图表数据、proxy 行为。
  - 不触碰 `lib/proxy.ts`。

## High-Level Design

本轮优先后台/控制台页面，Public/Auth 只做回归检查。`app/globals.css` 继续作为主要设计系统入口，复用现有 `.btn`、`.ui-input`、`.select-*`、`.table`、`.section`、`.modal`、`.stat` 等共享类。页面结构只在共享 CSS 无法解决时做少量 class 调整。

## Implementation Plan

### Stage 1: 规划文档
- **Files modified**: `docs/IMPLEMENTATION_PLAN.md`, `docs/plan/shadcn-console-redesign.md`
- **Specific logic**:
  - 新增后台页面紧凑重设计任务索引。
  - 记录后台优先范围、阶段、验证方式。
  - 明确 `lib/proxy.ts` 排除范围。
- **Validation**:
  - 文档可读，阶段可逐项更新状态。

### Stage 2: 全局后台紧凑设计系统
- **Files modified**: `app/globals.css`
- **Specific logic**:
  - 统一 `.btn`、`.ui-input`、`.field input/select/textarea`、`.select-trigger` 的尺寸、radius、focus、disabled 状态。
  - 统一 `.table-wrap`、`.table th/td`、`.sort-button`、`.empty` 的密度和 hover。
  - 统一 `.section`、`.settings-card`、`.modal`、`.toast`、`.status`、`.type-pill`、`.toggle-label`。
  - 统一 `.stat-strip`、`.stat`、`.perf-card`、`.channel-health-card`，支持 7-8 个指标自动紧凑换行。
- **Validation**:
  - `bunx tsc --noEmit`
  - 浏览器检查 `/keys`, `/channels`, `/settings` 控件和表格行高一致。

### Stage 3: Dashboard / 管理总览 / 状态页版式整理
- **Files modified**: `app/dashboard/page.tsx`, `app/admin/dashboard/page.tsx`, `app/admin/channel-status/page.tsx`, `app/globals.css`
- **Specific logic**:
  - 去掉重复 inline spacing，改为统一 section stack class。
  - 指标卡的单位、小数、meta 使用共享 class，不写 inline style。
  - 图表 section 与表格 section 使用同一 rhythm；不改 Recharts 数据或查询逻辑。
  - 渠道状态页保持高信息密度并统一 filter/status/table/pagination 视觉。
- **Validation**:
  - `/dashboard`, `/admin/dashboard`, `/admin/channel-status`, `/users/[id]` 页面加载正常。
  - 日期范围控件仍能提交原查询格式。

### Stage 4: 后台列表、表单、弹窗收尾
- **Files modified**: `app/globals.css`, representative components under `components/keys`, `components/channels`, `components/logs`, `components/users`, `components/models`, `components/mappings`, `components/pricing`, `components/audit`, `components/gift-cards`, `components/settings` only where shared CSS cannot cover.
- **Specific logic**:
  - 保留 `.list-toolbar`、`.table-wrap`、`.table`、`.list-pagination`，统一后台列表视觉。
  - 搜索框、select、批量操作、row action 使用统一 compact size。
  - `.field`、`.modal-head/body/foot`、settings card 使用统一 spacing。
  - 不重写排序、分页、筛选、SSE、fetch、mutation 逻辑。
- **Validation**:
  - `/keys`, `/admin/keys`, `/channels`, `/logs`, `/admin/logs`, `/users`, `/models`, `/mappings`, `/pricing`, `/audit`, `/gift-cards`, `/settings` 加载正常。
  - 搜索、select、分页、modal 打开/关闭可用。

### Stage 5: 最终验证
- **Files modified**: none expected
- **Specific logic**:
  - 类型检查、构建、浏览器烟测。
  - Public/Auth 只做快速回归，避免全局样式破坏。
- **Validation**:
  - `bunx tsc --noEmit`
  - `bun run build`
  - Browser smoke: `/dashboard`, `/admin/dashboard`, `/admin/channel-status`, `/keys`, `/admin/keys`, `/channels`, `/logs`, `/admin/logs`, `/users`, `/models`, `/mappings`, `/pricing`, `/audit`, `/gift-cards`, `/settings`, `/console/docs`, `/`, `/login`, `/docs`, `/model-square`。

## Testing Strategy

- Happy path:
  - 后台主要页面加载，控件尺寸统一紧凑。
  - 日期范围、筛选、分页、modal 基本交互正常。
- Error/negative path:
  - 无数据/空表格状态仍可读。
  - disabled/loading 状态仍可识别。
- Regression scope:
  - 侧边栏折叠不回退。
  - Public/Auth 页面没有被全局样式破坏。
  - `lib/proxy.ts` 不在本次改动范围。

## Risks & Mitigation

- Risk: 全局 CSS 影响面大。
  - Mitigation: 优先复用已有后台 class；每阶段浏览器烟测代表页面。
- Risk: 过度留白降低后台信息密度。
  - Mitigation: 控件保持 28-32px，表格保持紧凑行高。
- Risk: 图表视觉调整误改数据逻辑。
  - Mitigation: 只调容器/legend/spacing，不改 series、query、统计逻辑。
- Risk: 误触 backend/proxy。
  - Mitigation: 不编辑 `lib/proxy.ts`，提交前检查 diff。

## Rollback Plan

按文档、全局样式、Dashboard、列表/表单、验证分段提交；出现问题时回退对应段落即可。

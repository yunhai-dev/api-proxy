# Shadcn UI Migration Design Document

## Background & Goals

- Problem to solve: the frontend is built on a large custom `app/globals.css` visual system and semantic class names. The goal is to migrate the UI direction to shadcn/ui without preserving the current visual style.
- Success criteria:
  - Tailwind/shadcn foundation is installed and usable.
  - The global CSS baseline is shadcn-compatible instead of the old custom visual system.
  - The shared shell/navigation/page header layer is migrated first.
  - Existing product behavior, routes, auth checks, and data fetching remain unchanged.
  - `lib/proxy.ts` is not touched.

## High-Level Design

This migration is staged. The first pass establishes the new UI foundation and migrates the app chrome only. High-volume data tables, dialogs, select controls, forms, and page-specific cleanup are deferred until the shared primitives are stable.

Modules involved:

- `app/globals.css`: replace old visual system with Tailwind/shadcn tokens plus small temporary compatibility CSS.
- `app/layout.tsx`: keep provider/layout structure and attach new base styling.
- `components/app-shell.tsx`: preserve route-based shell split and migrate layout classes.
- `components/topbar.tsx`: preserve server-side settings/user loading and migrate topbar markup styling.
- `components/nav-tabs.tsx`: preserve nav definitions and active route behavior while switching to utility classes.
- `components/page-head.tsx`: preserve API and migrate markup classes.
- `components/site-logo.tsx`, `components/clock.tsx`, `components/user-menu.tsx`, `components/announcement.tsx`: adjust only if old class removal requires it.

## Implementation Plan

### Stage 1: Planning Docs

- **Files modified**: `docs/IMPLEMENTATION_PLAN.md`, `docs/plan/shadcn-ui-migration.md`
- **Specific logic**:
  - Register this migration in the high-level implementation plan.
  - Track only MVP stages in this pass.
  - Keep this detailed design document aligned with implementation status.
- **Validation**:
  - Confirm both docs mention the MVP scope and `lib/proxy.ts` exclusion.

### Stage 2: Tailwind and shadcn Foundation

- **Files modified**: `package.json`, Bun lockfile, `components.json`, Tailwind/PostCSS config files, `lib/utils.ts`, `app/globals.css`, new shadcn files under `components/ui/`
- **Specific logic**:
  - Initialize shadcn for App Router with CSS variables and the existing `@/*` alias.
  - Add only shell-needed primitives first, starting with `button` and any dependency required by the migrated shell.
  - Reuse a standard `cn()` helper from `lib/utils.ts`.
- **Validation**:
  - Run `bunx tsc --noEmit`.

### Stage 3: Global CSS Baseline

- **Files modified**: `app/globals.css`
- **Specific logic**:
  - Replace the old custom theme with shadcn/Tailwind variables and base styles.
  - Keep a small temporary compatibility layer for unmigrated pages: `.mono`, `.dim`, `.btn`, `.field`, `.field-row`, `.table-wrap`, `.table`, `.modal-*`, `.toast`, `.loading-spinner`.
  - Avoid class-by-class visual porting from the old theme.
- **Validation**:
  - Run `bunx tsc --noEmit`.
  - Run `bun run build`.

### Stage 4: Shell and Navigation Migration

- **Files modified**: `app/layout.tsx`, `components/app-shell.tsx`, `components/topbar.tsx`, `components/nav-tabs.tsx`, `components/page-head.tsx`, possibly `components/site-logo.tsx`, `components/clock.tsx`, `components/user-menu.tsx`, `components/announcement.tsx`
- **Specific logic**:
  - Preserve route split behavior in `AppShell`.
  - Keep `Topbar` server-side and preserve settings/user/announcement loading.
  - Use `cn()` for active/inactive nav classes.
  - Keep native `<details>` for the More menu in this MVP.
  - Remove dependencies on deleted old shell classes.
- **Validation**:
  - Run `bunx tsc --noEmit`.
  - Run `bun run build`.

### Stage 5: Smoke Verification

- **Files modified**: none unless fixing defects found during validation.
- **Specific logic**:
  - Run the dev server and check representative routes.
- **Validation**:
  - Visit `/`, `/login`, `/dashboard`, `/keys`, `/console/docs`.
  - Confirm topbar visibility, nav active state, user menu behavior, announcement rendering, and lack of obvious mobile overflow.

## Testing Strategy

- Happy path tests:
  - Type-check with `bunx tsc --noEmit`.
  - Production build with `bun run build`.
  - Browser smoke test public/auth/app route split.
- Error path tests:
  - Confirm existing toast calls still render through `ToastProvider`.
  - Confirm old unmigrated pages remain readable enough through the temporary compatibility CSS.
- Regression scope:
  - Login redirect behavior.
  - Admin vs user navigation visibility.
  - Announcement modal/marquee behavior.
  - User menu logout flow.

## Risks & Mitigation

- Risk: deleting old global CSS breaks unmigrated pages.
  - Mitigation: retain a tiny compatibility layer and remove it in later page/table/form stages.
- Risk: shadcn `Select` cannot replace the existing editable select directly.
  - Mitigation: do not migrate select in this MVP.
- Risk: server/client boundary changes break topbar data loading.
  - Mitigation: keep `Topbar` as a server component.
- Risk: accidental proxy/backend changes.
  - Mitigation: exclude `lib/proxy.ts` and check the diff before committing.

## Rollback Plan

Revert the migration commits in order. The first pass is deliberately split into docs, foundation, CSS baseline, and shell migration commits so each segment can be reverted independently.
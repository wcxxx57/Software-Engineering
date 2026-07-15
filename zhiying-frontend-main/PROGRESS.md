# PROGRESS.md

最后更新：2026-05-11

## 当前状态

核心学习闭环（学前测 → 计划 → 阶段/任务解锁 → 任务页 K2V/Interactive/解释/Quiz → 完成→下一任务）已通；三大工具页（K2V / C2V / Interactive）自由创建画廊上线；错题本/收藏页上线；TanStack Query 注水改用 `dehydrate` + `<HydrationBoundary>`，客户端导航不再被旧 cache 卡住。

## 已完成

### 基础设施
- Next.js 16.2.3 + React 19 + Tailwind v4 + ShadCN + TanStack Query。
- 路由分组 `(auth)` / `(app)` / `(learn)`，由 `src/middleware.ts` 按前缀守门。
- 认证：JWT + httpOnly cookie，浏览器端不接触 token；`serverFetch` 自动注入 `Authorization: Bearer`。
- 数据层：RSC 直 `serverFetch`；写操作走 Server Action + `revalidatePath`；轮询/跨组件 client cache 用 TanStack Query。
- Hydration：`dehydrate` + `<HydrationBoundary>` 在 RootLayout 与 Dashboard 注水；query key 工厂统一放 `src/lib/query/keys.ts`，避免 `"use client"` 边界问题。
- 业务常量从 `GET /api/v1/config` 拉取，前端不硬编码金额。

### 页面
- `(auth)/login`、`(auth)/register`：复用 `auth-modal-preview.html` 视觉，TanStack Form + Zod。
- `(app)/dashboard`：当前主题 + 阶段时间线 + 4 张工具入口卡 + 签到/钻石栏；右栏走 `@aside` parallel route slot。
- `(app)/mistakes`：错题/收藏列表 + 详情 Dialog（可切换可见性、可取消收藏）。
- `(learn)/pretest/[id]`：学前测做题 + 提交 → 触发 plan 生成。
- `(learn)/tasks/[id]`：任务页含 K2V / Interactive viewer / 解释卡 / Quiz 区，资源未生成时显示 `ResourceGenerateCard`。
- `(learn)/k2v` / `(learn)/c2v` / `(learn)/interactive`：三大工具自由创建画廊。

### 组件
- `components/ui/*`：ShadCN 组件库（按需）。
- `components/dashboard/*`：active subject area、feature grid、plan toolbar、subjects dialog、签到栏。
- `components/learn/*`：viewer（video / interactive html / explanation）、resource-generate-card、quiz section、journey timeline。
- `components/tools/*`：tool-page-shell、tool-console、tool-card、tool-result-player、tool-page-client。
- `components/mistakes/*`：错题列表卡 + 详情 Dialog。
- `components/spend-confirm-dialog.tsx`：通用消费确认对话框（钻石/金币、显示余额变化与不足提示）。
- `components/pretest/*`、`components/auth/*`、`components/panels/*`、`components/skeletons.tsx`。

### API 代理（`src/app/api/...`）
- 认证：`auth/login`、`auth/logout`、`auth/register`。
- 用户：`me`、`me/mistakes`、`me/bookmarks`。
- 学习主题：`study-subjects`（list/get/create/stages/...）、`study-stages`、`study-tasks`（含 `knowledge-video` / `interactive-html` / `quizzes` 子路径）。
- 小测：`study-quizzes`（含 `submit`、`problems`、`problem detail`）。
- 工具：`knowledge-videos` / `code-videos` / `interactive-htmls`（list / get / create / delete）。
- 公开：`config`。
- 错题/收藏切换：`quiz-problems/[id]/bookmark`、`mistake-visibility`。

### 已修过的坑
- `useState`-based one-time `setQueryData` 在客户端导航不刷新 → 改用 `dehydrate` + `<HydrationBoundary>`（`10073b6`、`707afc6`）。
- `studySubjectListQueryKey` 在 `"use client"` 模块导致 RSC 误调 → 拆到 `src/lib/query/keys.ts`（`478b4cc`）。
- 错题详情 Dialog 视觉与原型对齐（`6210cec`）。

## 进行中 / 未完成

- **错误展示统一**：RSC error boundary、Server Action 错误 toast helper、Query 全局 onError 都缺。当前 `serverFetch` 抛 `ApiError` 时直接红屏。
- **搜索栏**：Dashboard 顶部搜索框为 disabled placeholder，需后端 `q` 参数 + 下拉聚合。
- **移动端**：`lg:` 隐藏右侧栏的几个页面在窄屏没有替代入口。
- **设置页 / 用户中心**：改密、登出按钮、消费明细全无。
- **资源分享**：公开/取消公开切换、公开浏览页都未做。
- **钻石商店 / 充值**：缺面向用户的购买流程。
- **任务派生资源加入工具画廊**：需后端反向 link 后再做。

## 临时决策

- 工具页放在 `(learn)` 而非 `(app)`，按 prototype 对齐（`0f81184`）。
- query key 工厂统一放 `src/lib/query/keys.ts`，避免 `"use client"` 边界问题。
- 业务常量从 `GET /api/v1/config` 读取，前端不硬编码。

## 下一步建议

1. 统一错误展示：补 `error.tsx` 边界 + Server Action 错误 toast helper + Query 全局 `onError`，避免 Next 红屏直出。
2. 搜索栏点亮：后端就绪后接通 Dashboard 顶部搜索框，下拉聚合 + 跳转详情。
3. 移动端审查：`(app)/dashboard`、`(learn)/tasks/[id]` 在窄屏的右侧栏内容降级方案。

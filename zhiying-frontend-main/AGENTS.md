# AGENTS.md

本文件面向参与本仓库工作的 agent 与开发者，描述长期有效的协作约定。

## 文件分工

- `AGENTS.md`：记录稳定的项目协作规则、目录约定、设计边界、实现原则。
- `PROGRESS.md`：记录当前阶段的实现进度、已完成事项、待办、临时决策。

不要把强依赖当前进度的信息长期堆积在 `AGENTS.md` 中。

## 项目目标

智映通学（zhiying-tutor）的前端应用——基于 AI 的计算机领域个性化多模态学习系统。

技术栈：

- **框架**：Next.js 16（App Router，Turbopack）
- **UI 基础**：ShadCN（base-ui 底层）+ Tailwind CSS v4
- **表单**：TanStack Form + Zod
- **包管理**：pnpm
- **后端**：Rust Axum（sibling 仓库 `zhiying-backend`，REST API）
- **原型参考**：sibling 仓库 `zhiying-ui`（13 份 HTML 原型）

## Next.js 版本注意事项

**当前使用 Next.js 16.2.3，存在大量与训练数据中 Next.js 14/15 不同的 breaking change。**

在编写涉及以下 API 的代码前，必须先阅读 `node_modules/next/dist/docs/` 下对应文档：

- `cookies()`、`headers()`、`params`、`searchParams`：在 16 中为 async。
- Layout props 类型：使用全局 `LayoutProps<'/route'>` 而非手动声明。
- 路由约定、metadata API、错误边���等可能有变动。

## 设计原则

- 面向中文用户，所有用户可见文案使用中文。
- 优先复用 `src/components/ui/*` 中的 ShadCN 组件，不重造轮子。
- 不覆盖 Tailwind 默认主题值（如 border-radius 梯度），仅通过 CSS 变量扩展项目专属设计 token。
- 新增页面时参考 `zhiying-ui` 对应 HTML 原型的视觉与交互，但使用 ShadCN + Tailwind 工具类实现。

## 路由分组

| 分组 | 用途 | Layout 特征 |
|---|---|---|
| `(auth)` | 未登录页面：login、register | 居中卡片，渐变背景 |
| `(app)` | 登录后管理型页面：dashboard、mistakes、settings | 主内容 + 可选右侧栏（`@aside` parallel route） |
| `(learn)` | 沉浸型学习页面：subjects/tasks/pretest/quiz（待实现） | 极简顶栏，无侧栏 |

- `(app)` 与 `(learn)` 由 `src/middleware.ts` 按路径前缀守门，未登录重定向到 `/login`。
- `(app)` 的右侧栏通过 Next.js parallel route `@aside` slot 实现：
  - slot 文件位于 layout 同级：`src/app/(app)/@aside/{route}/page.tsx`
  - `src/app/(app)/@aside/default.tsx` 返回 `null`（未匹配时退化为单列）
  - 各页面直接在 `@aside/page.tsx` 中用纯 Tailwind 组合面板内容，不使用 wrapper 组件

## 目录约定

```
src/
├── app/
│   ├── (app)/              # 登录后管理型页面
│   │   ├── @aside/         # 右侧栏 parallel route slot
│   │   ├── dashboard/      # 主面板
│   │   └── layout.tsx      # 两列布局壳
│   ├── (auth)/             # 认证页面
│   ├── api/auth/           # 认证代理 route handler
│   └── layout.tsx          # 根布局（字体、Toaster）
├── components/
│   ├── ui/                 # ShadCN 组件（shadcn 工具管理，尽量不手动修改）
│   ├── auth/               # 认证相关组件
│   ├── dashboard/          # Dashboard 专属组件
│   ├── panels/             # 可复用面板（如 AI 聊天壳）
│   └── spend-confirm-dialog.tsx  # 通用消费确认对话框
├── lib/
│   ├── api/
│   │   ├── client.ts       # serverFetch 封装（auth cookie、Zod 校验、错误归一化）
│   │   ├── config.ts       # BACKEND_API_URL / API_PREFIX 常量
│   │   ├── public-config.ts # getPublicConfig()（React cache 去重）
│   │   ├── errors.ts       # ApiError / ApiSchemaError
│   │   └── schemas.ts      # 所有 Zod schema + 类型导出
│   ├── auth/
│   │   └── session.ts      # getSession()（读 cookie → GET /me）
│   └── utils.ts            # cn() 等工具函数
```

## 认证方案

JWT + httpOnly Cookie（Next.js Route Handler 代理）：

- `app/api/auth/login/route.ts`：POST 到后端 `/tokens`，拿 JWT 后 `cookies().set('zy_token', ...)`。
- `app/api/auth/register/route.ts`：POST 到后端 `/users`，注册成功后自动登录。
- `app/api/auth/logout/route.ts`：清除 cookie。
- 业务请求由 `serverFetch()` 自动从 cookie 读 token，加 `Authorization: Bearer` header。
- 浏览器端完全不接触 JWT。

## 数据层约定

| 场景 | 方案 |
|---|---|
| 首屏数据读取 | RSC 中直接 `serverFetch()` |
| 一次性写操作 | Server Action + `revalidatePath` |
| 状态机轮询 / 跨组件共享 client cache | TanStack Query（首次需要时再引入，不预装） |
| HUD 数值更新（货币 / EXP） | mutation 返回余额后 `queryClient.invalidateQueries(['me'])` |

硬性约束：不要因为装了 TanStack Query 就把所有读都迁进 Query——RSC 首屏直出是核心优势。

## 后端交互约定

- 后端 base URL 由环境变量 `BACKEND_API_URL` 定义（`.env.local`），默认 `http://localhost:9000`。
- 所有端点统一前缀 `/api/v1`，`serverFetch` 自动补全。
- 后端要求 `Content-Type: application/json`，即使 POST body 为空也需传 `body: {}`。
- 后端响应统一 envelope `{ "data": ... }`，`serverFetch` 自动解包。
- 前端可调业务常量（如定价、签到奖励序列）从 `GET /api/v1/config`（公开无需鉴权）获取，**不在前端硬编码金额**。

## 主题与样式约定

- 设计体系：N2W 暖色调，token 已在 `globals.css` 的 `@theme inline` 中注册。
- 品牌色使用语义 token：`brand-dark`、`brand-gold`、`palette-orange`、`palette-yellow` 等。
- 不覆盖 Tailwind 默认的 border-radius、spacing、font-size 等通用梯度。仅在无通用默认时通过 CSS 变量定义（如品牌色、语义色）。
- 半透明阴影使用 `color-mix(in oklch, ...)` 而非 `rgba()`。

## 开发约定

- 使用 `pnpm` 作为包管理器。
- 开发服务器：`pnpm dev`（默认 3000 端口）。
- 修改后至少确认 `pnpm exec tsc --noEmit` 无错误。
- 新增依赖使用 `pnpm add`。
- 提交信息参考 `git log --oneline` 现有风格：`feat: ...`、`fix: ...`、`chore: ...`。
- 验证 UI 交互时使用 chrome-devtools MCP 操作浏览器。
- 不保留无用代码、过渡封装或兼容性 shim。

## 文档约定

- 若只是当前阶段是否已实现、做到哪一步、下一步做什么，这类内容应写入 `PROGRESS.md`，不应写入 `AGENTS.md`。

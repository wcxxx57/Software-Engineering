# AGENTS.md

本文件面向参与本仓库工作的 agent 与开发者，描述长期有效的协作约定。

## 仓库性质

这是 **智映通学（zhiying-tutor）** 的 meta-repo，本身不包含可构建代码，只聚合多个并行的子仓库。各子仓库各自有独立的 `AGENTS.md`，进入子目录工作时这些文件会自动加载，本文件只描述跨仓库的全局视图。

子仓库布局：

| 目录 | 角色 | 技术栈 | 状态 |
|---|---|---|---|
| `zhiying-backend/` | 主后端，HTTP 网关 + 状态机 + 微服务调度 | Rust + Axum + Tokio + SeaORM | 主功能基本完成，等前端提需求 |
| `zhiying-frontend/` | Web 前端 | Next.js 16 + React 19 + Tailwind v4 + ShadCN + pnpm | 开发中，当前卡在微服务内容生成的轮询 |
| `zhiying-infra/` | 本地开发联调用的共享中间件 | docker compose（PostgreSQL 16 + RabbitMQ 4-management） | 稳定 |
| `zhiying-ui/` | 13 份 HTML 视觉/交互原型 | 静态 HTML，`python3 -m http.server` | 仅作前端实现参考 |
| `zhiying-mocks/` | （目前为空） | — | — |

跨仓库技术全景（分层图、状态机、解锁链、生成异步流程、数据模型形状）见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。**最新约定以各子仓库的 `AGENTS.md` 为准**，`ARCHITECTURE.md` 与本文件冲突时以代码与子仓库 `AGENTS.md` 为准。

## 跨仓库的关键约定（必须知道）

### 通信拓扑（最近一次重构后的最终形态）

- **前端 → 后端**：HTTP REST，`/api/v1/*` 同步。
- **后端 → 微服务（dispatch）**：RabbitMQ。每个微服务一个独立 direct exchange `zhiying.{service}`，绑定 queue `zhiying.{service}.generate`，routing key 固定为 `generate`。共 7 组：`knowledge_video / code_video / interactive_html / knowledge_explanation / pretest / plan / quiz`。
- **微服务 → 后端（callback）**：仍然走 HTTP，调用 `/internal/*`，用 `sk-` 前缀的 API Key 通过 `ServiceAuth` 提取器区分来源；dispatch 方向不再传 API Key。
- 内容生成类回调用 `PATCH /internal/{resource}/{id}`；学习主题类（pretest/plan/quiz）用 `POST /internal/{resource}/{id}`。
- 回调状态枚举大写：`QUEUING / GENERATING / FINISHED / FAILED`。`FAILED` 由后端按记录上的 `cost` 字段统一退款。
- 后端启动时 `declare_topology` 幂等声明全部 exchange/queue/binding（`durable=true`，`delivery_mode=2`），并启用 publisher confirm；nack/连接失败 → `BusinessError::ServiceUnavailable`，与原 HTTP 同步路径走同一退款逻辑。

### 共享中间件（zhiying-infra）

所有后端/微服务的本地开发都连接 `zhiying-infra/compose.yaml` 启动的实例，避免各仓库自带导致联调串台：

- PostgreSQL：`localhost:5432`，用户/密码 `dev` / `dev`，单实例多库，每个服务一个独立 database，库名 `zhiying_<service>`（如 `zhiying_backend`）。
- RabbitMQ：AMQP `localhost:5672`，管理 UI `localhost:15672`，凭据 `dev` / `dev`，vhost `/`（连接串里编码为 `%2f`）。
- 新增服务库：改 `zhiying-infra/postgres/init/01-create-databases.sql`；已运行的环境用 `docker compose exec postgres psql -U dev -c 'CREATE DATABASE "<name>";'` 即时建库（init 脚本只在 `PGDATA` 为空时执行）。
- 彻底重置：`docker compose down -v`（会清空 `zhiying-dev_postgres-data` / `zhiying-dev_rabbitmq-data` 命名卷）。

CI、staging、生产**不**使用本仓库——CI 用 testcontainers 或 in-memory 替代实现。

### 子仓库内规则速查

进入对应子目录工作时优先读取该目录的 `AGENTS.md`，重点摘录：

- **`zhiying-backend/`**
  - 修改后至少 `cargo fmt` 和 `cargo check`。新增依赖用 `cargo add`。
  - 启动时直接执行 SeaORM migration；早期阶段允许删库重建，migration 用顺序编号 `m0001_init_schema.rs`。
  - 不要写死 PostgreSQL 方言——目标兼容 `sqlite / postgresql / mysql`。
  - 业务唯一字段必须有数据库唯一约束，应用层查重只用于友好错误。
  - 错误统一走 `src/error.rs`；用户可见错误中文；校验错误统一返回 `VALIDATION_FAILED`（不直接透传 validator 原文）。
  - 计数字段用复数：`total_checkins / streak_checkins / total_stages / finished_tasks`。
  - 路由按资源领域拆分到 `src/routes/`；当前用户资源统一用 `me`，不要再引入 `self`。
  - 微服务 dispatch 函数放在 `src/services/`。
  - 学习主题状态机 8 状态（`PretestQueuing → ... → Studying → Finished/Failed`）；阶段/任务各 3 状态（`Locked/Studying/Finished`），按 `sort_order` 强制顺序解锁；统计字段非规范化，状态变更时维护。

- **`zhiying-frontend/`**
  - 包管理 `pnpm`，开发 `pnpm dev`（3000），改完至少 `pnpm exec tsc --noEmit`。
  - **Next.js 16.2.3**：`cookies()` / `headers()` / `params` / `searchParams` 都是 async；Layout props 用全局 `LayoutProps<'/route'>`。涉及这些 API 时先看 `node_modules/next/dist/docs/`，不要套 14/15 的写法。
  - 路由分三组：`(auth)` / `(app)` / `(learn)`，由 `src/middleware.ts` 按前缀守门。`(app)` 的右侧栏用 parallel route `@aside` slot（`@aside/default.tsx` 返回 `null` 退化单列）。
  - 认证：JWT + httpOnly cookie，由 `app/api/auth/*` route handler 代理；浏览器端不接触 JWT。`serverFetch()` 自动从 cookie 取 token 并加 `Authorization: Bearer`。
  - 后端 base URL `BACKEND_API_URL`（默认 `http://localhost:9000`），统一前缀 `/api/v1`，响应 envelope `{ "data": ... }` 由 `serverFetch` 解包。POST 即使空 body 也要传 `body: {}`。
  - 数据层：RSC 直 `serverFetch`；写操作走 Server Action + `revalidatePath`；轮询/跨组件 client cache 用 TanStack Query（首次需要时再装，**不预装**，不要把所有读迁进 Query）。
  - 不在前端硬编码定价 / 签到奖励等业务常量——从 `GET /api/v1/config`（公开）读。
  - UI：优先复用 `src/components/ui/*` 的 ShadCN 组件；不覆盖 Tailwind 默认梯度，只通过 CSS 变量扩展品牌色 token；半透明色用 `color-mix(in oklch, ...)`。

- **`zhiying-infra/`**：仅本地开发；新增中间件（Redis/MinIO 等）走 PR 在本仓库统一加入，不要在某个服务仓库私自启动。

### 进度追踪

每个子仓库有自己的 `PROGRESS.md` 记录当前实现进度与待办——查"做到哪了"先看那里，不要在 `AGENTS.md` 里堆当前进度类信息。

## 常用命令

```bash
# 启动联调用中间件
cd zhiying-infra && docker compose up -d
docker compose ps                    # 应看到两个 healthy
docker compose down -v               # 彻底重置（清卷，重新跑 init 脚本）

# 后端（zhiying-backend）
cargo fmt && cargo check
cargo run                            # 启动时跑 migration + declare_topology

# 前端（zhiying-frontend）
pnpm install
pnpm dev                             # localhost:3000
pnpm exec tsc --noEmit               # 类型检查

# UI 原型预览（zhiying-ui）
just serve                           # tmux + http.server 3001 + xdg-open
just stop
```

## 提交信息风格

各子仓库均采用前缀式简洁格式：`feat: ...` / `fix: ...` / `chore: ...` / `init: ...`。提交前 `git log --oneline` 对一下当前风格再写。

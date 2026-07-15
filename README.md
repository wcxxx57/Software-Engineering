# 智映通学（zhiying-tutor）单仓库

本仓库已将原先分散在多个 Git 仓库中的前端、后端、Mock 微服务、本地基础设施、UI 原型和架构资料统一整合。现在只需克隆一个仓库，即可查看全部代码、进行本地联调，或用 Docker Compose 构建部署完整演示环境。

目标远端仓库：[`wcxxx57/Software-Engineering`](https://github.com/wcxxx57/Software-Engineering)

## 1. 目录与功能

| 目录 | 主要功能 | 技术栈 |
|---|---|---|
| `zhiying-frontend-main/` | 面向学生的 Web 应用：注册登录、学习主题、前测、学习计划、学习任务、视频/讲解/互动内容、小测、错题与个人设置 | Next.js 16、React 19、TypeScript、Tailwind CSS v4、ShadCN、pnpm |
| `zhiying-backend-main/` | REST API、JWT 认证、用户与签到、余额与计费、学习状态机、数据库迁移、异步任务发布、微服务回调 | Rust、Axum、Tokio、SeaORM、PostgreSQL/MySQL/SQLite |
| `zhiying-mock-main/` | 模拟 7 类 AI/内容生成服务，消费 RabbitMQ 消息并回调后端，适合开发、联调和演示 | Python 3.13、aio-pika、httpx、Pydantic、uv |
| `zhiying-infra-main/` | 本地开发共享中间件 | Docker Compose、PostgreSQL 16、RabbitMQ 4、MinIO |
| `zhiying-ui-main/` | 早期静态 HTML 视觉与交互原型，供前端实现参考 | HTML/CSS/JavaScript |
| `zhiying-meta-main/` | 原多仓库时期的架构与编排资料，现作为历史/补充文档保留 | Markdown、Docker Compose、just |

更详细的生产架构、服务职责和故障排查见 [`DEPLOYMENT_AND_ARCHITECTURE.md`](./DEPLOYMENT_AND_ARCHITECTURE.md)。

## 2. 整体架构

```mermaid
flowchart LR
    U[浏览器用户] -->|HTTPS| NPM[Nginx Proxy Manager]
    NPM --> FE[Next.js 前端]
    FE -->|REST /api/v1| BE[Rust 后端]
    BE --> PG[(PostgreSQL)]
    BE -->|发布 7 类生成任务| MQ[(RabbitMQ)]
    MQ --> MOCK[Python Mock 微服务]
    MOCK -->|HTTP 内部回调| BE
    BE --> OSS[(S3 / 阿里云 OSS)]
    FE -->|访问视频与互动资源| OSS
```

核心调用方式：

- 浏览器访问 Nginx Proxy Manager，由它把公网请求转发到 `frontend:3000`；
- 前端服务端通过 REST API 调用 `backend:9000`；
- 后端使用 PostgreSQL 保存用户、学习计划、题目、状态和计费数据；
- 后端把前测、计划、小测、视频、互动 HTML、知识讲解等任务发布到 RabbitMQ；
- Mock 服务消费任务，先回调 `GENERATING`，再回调 `FINISHED` 或 `FAILED`；
- 视频和 HTML 等二进制资源放在 S3 兼容对象存储中，数据库只保存对象键和元数据。

## 3. 快速本地开发

### 3.1 环境要求

- Docker 24+ 与 Docker Compose v2；
- Rust stable（后端）；
- Node.js 22 与 pnpm 10（前端）；
- Python 3.13 与 uv（Mock）；
- 可选：`just`，用于执行根目录快捷命令。

### 3.2 启动本地中间件

```bash
docker compose -f zhiying-infra-main/compose.yaml up -d
```

默认服务：

| 服务 | 地址 | 本地开发凭据 |
|---|---|---|
| PostgreSQL | `localhost:5432` | `dev / dev` |
| RabbitMQ | `localhost:5672` | `dev / dev` |
| RabbitMQ 管理台 | `http://localhost:15672` | `dev / dev` |
| MinIO S3 API | `http://localhost:9100` | `dev / devdevdev` |
| MinIO 管理台 | `http://localhost:9101` | `dev / devdevdev` |

这些凭据只能用于本地开发，不能用于公网或生产环境。

### 3.3 分别启动三个业务服务

后端：

```bash
cd zhiying-backend-main
cp .env.example .env
# 若使用本地 PostgreSQL，把 DATABASE_URL 改成：
# postgres://dev:dev@localhost:5432/zhiying_backend
cargo run
```

Mock 微服务：

```bash
cd zhiying-mock-main
cp .env.example .env
uv sync
uv run zhiying-mocks
```

前端：

```bash
cd zhiying-frontend-main
pnpm install --frozen-lockfile
$env:BACKEND_API_URL="http://localhost:9000"   # PowerShell
pnpm dev
```

浏览器访问 `http://localhost:3000`。

## 4. 单机 Docker Compose 部署

根目录 [`compose.yaml`](./compose.yaml) 会直接从当前仓库构建 backend、mocks 和 frontend，并启动 PostgreSQL、RabbitMQ 与 Nginx Proxy Manager。

### 4.1 准备配置

```bash
cp .env.example .env
```

必须修改：

- `PUBLIC_HOST`：实际域名；
- PostgreSQL 和 RabbitMQ 密码；
- `JWT_SECRET`：足够长的随机字符串；
- 8 个 `sk-` 开头的内部 API Key；
- OSS/S3 Endpoint、AccessKey、SecretKey、Region、Bucket 和公开访问前缀。

生产 `.env` 已被 Git 忽略，禁止提交密码、Token、AccessKey 或真实私钥。

### 4.2 构建并启动

```bash
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
```

查看日志：

```bash
docker compose --env-file .env logs -f --tail=200
```

停止服务但保留数据：

```bash
docker compose --env-file .env down
```

若安装了 `just`，可使用 `just up`、`just ps`、`just logs` 和 `just down`。

### 4.3 配置 HTTPS 入口

Compose 默认只公开：

- `80`：HTTP/证书验证；
- `443`：HTTPS；
- `127.0.0.1:81`：Nginx Proxy Manager 管理台，仅服务器本机可访问。

建议用 SSH 隧道访问管理台：

```bash
ssh -L 8081:127.0.0.1:81 user@your-server
```

然后打开 `http://localhost:8081`，创建 Proxy Host：

```text
Domain: 你的 PUBLIC_HOST
Scheme: http
Forward Hostname: frontend
Forward Port: 3000
SSL: Let's Encrypt
Force SSL: enabled
```

不要把 PostgreSQL、RabbitMQ、backend 等内部端口直接暴露到公网。

## 5. 关键配置关系

- backend 与 mocks 的 7 个回调 API Key 必须完全一致；
- backend 与 RabbitMQ 必须使用同一用户名、密码和默认 vhost `/`；
- `BACKEND_API_URL` 在容器内使用 `http://backend:9000`，本机开发使用 `http://localhost:9000`；
- `CORS_ALLOW_ORIGIN` 由 `PUBLIC_HOST` 生成，生产环境为 `https://<域名>`；
- 对象存储中的视频/HTML 文件不进入 PostgreSQL，后端只保存 `object_key`；
- Mock 仅用于联调和演示，不包含真实 AI 推理，也没有重试、死信队列和生产级可观测性。

## 6. 代码校验

```bash
# Rust 格式与编译检查
cd zhiying-backend-main
cargo fmt --check
cargo check

# 前端类型与代码检查
cd ../zhiying-frontend-main
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint

# Python Mock 基础编译检查
cd ../zhiying-mock-main
uv sync --frozen
uv run python -m compileall -q src
```

## 7. Git 提交与推送（全新历史）

本仓库是单一 Git 工作树，六个项目目录中不应再出现独立 `.git`。为了不把任何旧仓库的 commit 记录带到新仓库，应从 orphan 分支创建一个没有父提交的初始快照：

```bash
git switch --orphan monorepo-initial
git add -A
git commit -m "init: import zhiying monorepo snapshot"
git remote set-url origin https://github.com/wcxxx57/Software-Engineering.git
git push -u origin monorepo-initial
```

该初始提交的 `git rev-list --parents -n 1 HEAD` 输出应只有一个 commit hash，不应再跟父 commit hash。如果希望让当前成果成为远端默认 `main`，应先确认目标仓库现有 `main` 是否可以替换，再将这个无父提交快照推送为 `main`；不要未经检查直接覆盖远端已有重要提交。

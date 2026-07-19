# 智映通学核心学习链路

本仓库是智映通学的单仓库部署版本，当前维护下面六个真实学习与生成能力：

```text
课前测试
→ 个性化学习计划
→ 每个任务的深度解析与知识导图
→ 每个任务的 2D 可视化操作
→ 每个任务的知识视频
→ 每个任务的课后小测
```

课前测、计划、深度解析和课后测由 `core-generation` 生成；2D 可视化由 `education2d` 的 LangGraph Agent 生成；知识视频由 `knowledge2video` 的 FastAPI、Celery、Manim、FFmpeg 与 TTS 管线生成。仓库不包含离线生成替代服务。

目标远端仓库：[`wcxxx57/Software-Engineering`](https://github.com/wcxxx57/Software-Engineering)

## 1. 目录

| 目录 | 作用 | 技术栈 |
|---|---|---|
| `frontend/` | 注册登录、课前测试、学习计划、任务深度解析、知识导图、课后小测 | Next.js 16、React 19、TypeScript |
| `backend/` | REST API、JWT、学习状态机、数据库、RabbitMQ 发布与内部回调 | Rust、Axum、SeaORM |
| `services/core-generation/` | 四个真实 LLM 消费者 | Python 3.13、aio-pika、httpx、Pydantic |
| `services/education2d/` | 2D 可视化生成、播放、缩放、版本历史和自然语言编辑 | React、Vite、Express、LangGraph |
| `services/knowledge2video/` | 知识视频规划、分镜、旁白、Manim 渲染、合并与 API | Python、FastAPI、Celery、Redis、Manim、FFmpeg |
| `infra/` | 可选的本地中间件编排 | PostgreSQL、RabbitMQ、MinIO |
| `scripts/` | 服务器发布脚本 | Bash、Docker Compose |

生成服务的目录与部署边界见 [`services/README.md`](./services/README.md)。部署与验收步骤见 [`docs/CORE_FLOW_DEPLOYMENT.md`](./docs/CORE_FLOW_DEPLOYMENT.md)，生产架构和排障见 [`docs/DEPLOYMENT_AND_ARCHITECTURE.md`](./docs/DEPLOYMENT_AND_ARCHITECTURE.md)，后续增加其他真实生成服务的边界见 [`docs/MICROSERVICE_EXTENSION.md`](./docs/MICROSERVICE_EXTENSION.md)。

多模态本地联调步骤见 [`docs/MULTIMODAL_LOCAL_VALIDATION.md`](./docs/MULTIMODAL_LOCAL_VALIDATION.md)；知识视频服务的内部结构、任务去重和独立 API 调试方式见 [`services/knowledge2video/README.md`](./services/knowledge2video/README.md)。

## 2. 架构

```mermaid
flowchart LR
    U["浏览器"] -->|"HTTPS"| NPM["Nginx Proxy Manager"]
    NPM --> FE["Next.js frontend"]
    FE -->|"REST"| BE["Rust backend"]
    BE --> PG[("PostgreSQL")]
    BE -->|"发布生成任务"| MQ[("RabbitMQ")]
    MQ --> CORE["core-generation（4 个文本消费者）"]
    MQ --> EDU["education2d"]
    MQ --> K2V["knowledge2video bridge"]
    CORE --> LLM["OpenAI-compatible LLM API"]
    EDU --> LLM
    K2V --> CELERY["Celery 视频 Worker"]
    CELERY --> TTS["LLM + TTS + Manim/FFmpeg"]
    K2V --> MINIO[("MinIO")]
    CORE -->|"内部状态与结果回调"| BE
    EDU -->|"可视化 ID 回调"| BE
    K2V -->|"视频对象 Key 回调"| BE
```

正常学习链路不会由浏览器直接调用 Knowledge2Video API。后端把任务发布到 RabbitMQ，`knowledge-video-bridge` 使用稳定的 Celery task ID 提交长任务，Worker 完成渲染后由 bridge 上传 MinIO 并回调后端。`knowledge-video-api` 仅用于保留原生 SSE/API 能力和独立调试。

`core-generation` 在一个容器中运行四个独立 RabbitMQ 消费者：

| 消费者 | Exchange | Queue |
|---|---|---|
| `pretest` | `zhiying.pretest` | `zhiying.pretest.generate` |
| `plan` | `zhiying.plan` | `zhiying.plan.generate` |
| `knowledge_explanation` | `zhiying.knowledge_explanation` | `zhiying.knowledge_explanation.generate` |
| `quiz` | `zhiying.quiz` | `zhiying.quiz.generate` |

## 3. 本地 Docker 启动

要求：

- Docker Desktop 或 Docker Engine；
- Docker Compose v2；
- 可访问的 OpenAI-compatible Chat Completions API。
- 生成真实知识视频时可用的 vivo TTS `APP_ID` 与 `APP_KEY`。

复制配置：

```powershell
Copy-Item .env.example .env
```

填写 `.env` 中的数据库密码、RabbitMQ 密码、JWT、六个回调/服务 Key、对象存储配置，以及：

```dotenv
LLM_BASE_URL=https://provider.example/v1
LLM_API_KEY=...
LLM_MODEL=...

VIVO_TTS_APP_ID=...
VIVO_TTS_APP_KEY=...
```

启动唯一的真实版本：

```powershell
docker compose --env-file .env -f compose.yaml -f compose.local.yaml config --quiet
docker compose --env-file .env -f compose.yaml -f compose.local.yaml up -d --build
docker compose --env-file .env -f compose.yaml -f compose.local.yaml ps
```

本地入口：

| 服务 | 地址 |
|---|---|
| 前端 | `http://127.0.0.1:3080` |
| 后端健康检查 | `http://127.0.0.1:9000/health` |
| RabbitMQ 管理台 | `http://127.0.0.1:15672` |
| NPM 管理台 | `http://127.0.0.1:81` |
| Knowledge2Video API | `http://127.0.0.1:8080/docs` |
| MinIO API / 管理台 | `http://127.0.0.1:9100` / `http://127.0.0.1:9101` |

查看核心日志：

```powershell
docker compose --env-file .env -f compose.yaml -f compose.local.yaml logs -f --tail 200 backend core-generation education2d knowledge-video-bridge knowledge-video-worker frontend
```

停止但保留数据库和证书：

```powershell
docker compose --env-file .env -f compose.yaml -f compose.local.yaml down
```

禁止使用 `down -v`，否则可能删除 PostgreSQL、RabbitMQ、NPM 配置和 HTTPS 证书卷。

## 4. 生产镜像和部署

合并到 `main` 后，[`.github/workflows/publish-images.yml`](./.github/workflows/publish-images.yml) 发布：

```text
ghcr.io/wcxxx57/software-engineering-backend
ghcr.io/wcxxx57/software-engineering-frontend
ghcr.io/wcxxx57/software-engineering-core-generation
ghcr.io/wcxxx57/software-engineering-education2d
ghcr.io/wcxxx57/software-engineering-knowledge2video
```

服务器部署目录默认为 `/opt/zhiying`：

```bash
cd /opt/zhiying
git pull --ff-only
chmod 750 scripts/deploy.sh
./scripts/deploy.sh sha-<commit>
```

若使用 `latest`：

```bash
./scripts/deploy.sh latest
```

生产脚本会校验 Compose、拉取三个业务镜像并执行 `up -d --remove-orphans`，不会删除数据卷。

## 5. 提交前校验

```powershell
# Compose
docker compose --env-file .env -f compose.yaml -f compose.local.yaml config --quiet

# 真实生成服务
docker compose --env-file .env -f compose.yaml -f compose.local.yaml build core-generation

# 后端与前端生产镜像
docker compose --env-file .env -f compose.yaml -f compose.local.yaml build backend frontend

# 运行状态
docker compose --env-file .env -f compose.yaml -f compose.local.yaml up -d
docker compose --env-file .env -f compose.yaml -f compose.local.yaml ps
```

生产 `.env`、API Key、Token 和服务器凭据不得提交 Git。

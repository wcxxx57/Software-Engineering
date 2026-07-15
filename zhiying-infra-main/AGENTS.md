# AGENTS.md

本仓库面向 `zhiying-tutor` 全体后端 / 微服务的本地开发与联调，提供共享的中间件（PostgreSQL、RabbitMQ、MinIO）。
所有需要这些中间件的服务都应连接由本仓库 `compose.yaml` 启动的实例，避免各服务自带一份导致联调时串台。

## 文件分工

- `AGENTS.md`：稳定的跨服务契约（端口、凭据、命名约定、演进规则）。
- `README.md`：使用说明（启动 / 停止 / 常用排查命令）。
- `compose.yaml`：本地开发用的 docker compose 定义。
- `postgres/init/`：postgres 镜像 entrypoint 在 `PGDATA` 为空时按字典序执行的初始化脚本（`*.sh` / `*.sql` / `*.sql.gz`），由镜像自身约定，与 docker compose 无关。数据目录非空则跳过。
- MinIO bucket 与 anonymous 策略由 `compose.yaml` 中的 `minio-init` 一次性服务负责创建（用 `mc` 客户端，幂等）。

不要把临时调试笔记或某个服务的私有配置长期堆积在本仓库。

## 适用范围

- 仅面向本地开发与联调，**不**适用于 CI、staging、生产。
- CI 中的集成测试应使用 `testcontainers` 或服务自身的 in-memory 替代实现，不依赖本仓库。
- 生产 / staging 的中间件由独立的部署仓库管理。

## 服务清单与默认端口

| 服务 | 镜像 | 主机端口 | 备注 |
| --- | --- | --- | --- |
| PostgreSQL | `postgres:16-alpine` | `5432` | 用户 / 密码：`dev` / `dev` |
| RabbitMQ | `rabbitmq:3.13-management` | `5672`（AMQP）、`15672`（管理 UI） | 用户 / 密码：`dev` / `dev`，vhost：`/` |
| MinIO | `minio/minio:latest` | `9100`（S3 API）、`9101`（管理 UI） | 用户 / 密码：`dev` / `devdevdev`；端口 9100/9101 系刻意避开主后端默认 9000 |

凭据为本地开发约定值，禁止在生产环境复用。新增端口映射前需确认与本机其他常用服务不冲突。

## PostgreSQL 约定

- 单实例多库：每个服务一个独立 database，库名以 `zhiying_` 前缀 + 服务名，例如 `zhiying_backend`、`zhiying_pretest`。
- 所有库共用同一个超级用户 `dev`，本地开发不区分细粒度角色。
- 各服务在自己的 `.env.example` 中给出连接串模板：
  `postgres://dev:dev@localhost:5432/zhiying_<service>`
- 新增服务库的流程：
  1. 修改 `postgres/init/01-create-databases.sql`，追加 `CREATE DATABASE` 语句。
  2. 已运行的环境通过 `docker compose exec postgres psql -U dev -c 'CREATE DATABASE "<name>";'` 即时创建（init 脚本不会重复执行）。
  3. 全新环境需要 `docker compose down -v && docker compose up -d` 才会触发 init 脚本。
- schema 演进由各服务自身的 migration 工具负责，本仓库不持有任何业务表结构。

## RabbitMQ 约定

dispatch 方向（后端 → 微服务）使用 RabbitMQ；回调方向（微服务 → 后端）继续使用 HTTP。

- **Exchange**：单一 topic exchange `zhiying.tasks`，由生产者（后端）启动时声明，`durable=true`。
- **Routing key**：`<service>.generate`，与服务名一一对应：
  - `knowledge_video.generate`
  - `code_video.generate`
  - `interactive_html.generate`
  - `knowledge_explanation.generate`
  - `pretest.generate`
  - `plan.generate`
  - `quiz.generate`
- **Queue**：每个微服务一个独立 queue，命名为 `<service>.tasks`，`durable=true`，绑定到上述 routing key。queue 由对应消费者（微服务）启动时声明。
- **声明幂等**：exchange 与 queue 的声明在生产者与消费者侧各自重复执行，参数必须一致，否则 RabbitMQ 会拒绝。
- **Publisher confirm**：生产者必须开启 `confirm_select`，未收到 confirm 视为入队失败，对应业务上的 `ServiceUnavailable`。
- **消息属性**：`content_type=application/json`、`delivery_mode=2`（持久化）、`message_id` 建议使用业务 task_id。
- **消息体**：与原 HTTP body 保持一致（包含 `task_id` + 各业务字段），不引入额外封装。
- **新增微服务流程**：在本文件追加 routing key 与 queue 命名，再分别在生产者 / 消费者代码中声明。

## 凭据与连接串

各服务 `.env.example` 中应使用以下连接串模板，方便新人 clone 后零改动联通本仓库实例：

- `DATABASE_URL=postgres://dev:dev@localhost:5432/zhiying_<service>`
- `RABBITMQ_URL=amqp://dev:dev@localhost:5672/%2f`
- `STORAGE_ENDPOINT=http://localhost:9100`
- `STORAGE_ACCESS_KEY=dev`
- `STORAGE_SECRET_KEY=devdevdev`
- `STORAGE_BUCKET=zhiying-content`
- `STORAGE_PUBLIC_BASE=http://localhost:9100`

## MinIO 约定

dispatch 与回调链路以外，所有需要持久化二进制资源（视频、互动 HTML bundle、配套静态文件等）的微服务统一写到本仓库 MinIO，主后端只存 key 不接触字节。

- **单 bucket**：`zhiying-content`，公开 read（`anonymous=download`）。所有资源走 capability-based —— 路径用不可猜的 UUID 作为 key，知道 key 等于拥有访问权。
- **业务前缀约定**（在 bucket 内按一级目录分类，便于审计与生命周期管理）：
  - `knowledge-videos/{uuid}.mp4`
  - `code-videos/{uuid}.mp4`
  - `interactive-html/{uuid}/index.html`（多文件 bundle 同前缀下放置 `*.js` / `*.css` 等资产）
  - `shared/runtime/v1.js`（互动 HTML 共享脚本固定位置；prompt 模板告知 LLM）
- **public_base**：当前与 `STORAGE_ENDPOINT` 同值。后续上 CDN 时只改主后端 config（前端从 `/api/v1/config` 拿 `public_base`，自行拼接 URL）。
- **bucket 与策略初始化**：由 compose 中 `minio-init` 一次性服务用 `mc` 完成（幂等）。新增前缀约定时只需更新本文件，无需修改 init 脚本。

## 数据卷与重置

- `postgres-data`、`rabbitmq-data`、`minio-data` 为命名卷。compose 实际创建的卷名由 project name 加前缀，本仓库在 `compose.yaml` 中显式声明 `name: zhiying-dev`，因此实际卷名为 `zhiying-dev_postgres-data`、`zhiying-dev_rabbitmq-data`、`zhiying-dev_minio-data`，不会与其他 compose 项目的同名卷冲突。
- `docker compose down` 不会删除卷。
- 需要彻底重置（重新触发 postgres init、清空 RabbitMQ / MinIO 状态）时使用 `docker compose down -v`。
- 重置前请确认没有未持久化的本地业务数据，必要时先 `pg_dump` / `mc mirror`。

## 演进原则

- compose 文件保持中间件「干净」：只负责把进程跑起来，业务相关的 exchange / queue / 表结构不在此声明。
- 新增中间件（Redis、MinIO、向量库等）走 PR 在本仓库统一加入，避免各服务私自启动。
- 镜像版本固定到 minor，大版本升级需要 PR 评估对所有服务的影响。

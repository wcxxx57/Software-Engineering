# zhiying-infra

`zhiying-tutor` 项目本地开发与联调用的共享中间件，包含 PostgreSQL、RabbitMQ 与 MinIO。

后端、各微服务在本地开发时统一连接由本仓库启动的实例，以保证消息队列、数据库等基础设施在所有服务之间一致，避免各仓库自带导致的串台问题。

跨服务的命名约定（数据库名、RabbitMQ exchange / queue / routing key 等）见 [AGENTS.md](./AGENTS.md)。

## 适用范围

仅用于本地开发。CI 集成测试、staging、生产环境均不依赖本仓库。

## 前置依赖

- Docker 24+ 或兼容的容器运行时（Podman 等）
- Docker Compose v2

## 快速开始

```bash
git clone <this-repo>
cd zhiying-infra
docker compose up -d
```

首次启动会拉取镜像并初始化卷，约 10–30 秒。`docker compose ps` 应显示三个长驻服务（postgres、rabbitmq、minio）都处于 `healthy` 状态；`minio-init` 是一次性 bucket 初始化容器，运行完会以 `Exited (0)` 状态停留。

服务启动后默认监听：

| 服务 | 地址 | 凭据 |
| --- | --- | --- |
| PostgreSQL | `localhost:5432` | `dev` / `dev` |
| RabbitMQ AMQP | `localhost:5672` | `dev` / `dev` |
| RabbitMQ 管理 UI | http://localhost:15672 | `dev` / `dev` |
| MinIO S3 API | http://localhost:9100 | `dev` / `devdevdev` |
| MinIO 管理 UI | http://localhost:9101 | `dev` / `devdevdev` |

## 在各服务中使用

各服务 `.env`（或对应配置）按以下模板填写：

```env
DATABASE_URL=postgres://dev:dev@localhost:5432/zhiying_<service>
RABBITMQ_URL=amqp://dev:dev@localhost:5672/%2f
STORAGE_ENDPOINT=http://localhost:9100
STORAGE_ACCESS_KEY=dev
STORAGE_SECRET_KEY=devdevdev
STORAGE_BUCKET=zhiying-content
STORAGE_PUBLIC_BASE=http://localhost:9100
```

`<service>` 取值见 [AGENTS.md](./AGENTS.md) 的服务清单。

## 常用命令

```bash
# 启动 / 停止
docker compose up -d
docker compose stop
docker compose down            # 停止并移除容器，保留数据卷
docker compose down -v         # 同时清空数据卷（彻底重置）

# 查看状态与日志
docker compose ps
docker compose logs -f postgres
docker compose logs -f rabbitmq
docker compose logs -f minio

# 进入 psql
docker compose exec postgres psql -U dev -d zhiying_backend

# 即时新建一个数据库（init 脚本仅在首次初始化时执行）
docker compose exec postgres psql -U dev -c 'CREATE DATABASE "zhiying_xxx";'

# 列出 RabbitMQ queue
docker compose exec rabbitmq rabbitmqctl list_queues

# 用 mc 操作 MinIO（容器内自带 alias 已在 minio-init 中配好）
docker compose exec minio-init mc ls local/zhiying-content
docker compose exec minio-init mc cp /etc/hosts local/zhiying-content/test.txt
```

## 添加新的数据库

1. 在 [`postgres/init/01-create-databases.sql`](./postgres/init/01-create-databases.sql) 中追加 `CREATE DATABASE` 语句。
2. 已运行的本地环境通过上面的 `psql -c 'CREATE DATABASE ...'` 即时创建。
3. 全新环境会通过 init 脚本自动创建。

## 添加新的中间件

新增 Redis、MinIO 等共享中间件时，在本仓库提 PR 修改 `compose.yaml` 与 `AGENTS.md`，不要在某个服务仓库内自带一份。

## 故障排查

- **端口占用**：检查本机是否已运行其他 PostgreSQL / RabbitMQ / MinIO 实例，停掉或修改 `compose.yaml` 端口映射。MinIO 故意走 9100/9101 而非默认 9000/9001 以避开主后端 9000。
- **healthcheck 不通过**：`docker compose logs` 查看具体错误；持续异常可尝试 `docker compose down -v` 后重启。
- **服务连不上 RabbitMQ**：确认连接串中的 vhost 正确编码为 `%2f`（默认 vhost `/`）。
- **MinIO bucket 不存在**：`minio-init` 容器应已自动创建。如果异常，手动运行：
  ```bash
  docker compose run --rm minio-init
  ```

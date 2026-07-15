default:
  @just --list

# 校验生产 Compose 配置（需要根目录 .env）
config:
  docker compose --env-file .env config --quiet

# 从当前单仓库源码构建并启动生产/演示栈
up:
  docker compose --env-file .env up -d --build

down:
  docker compose --env-file .env down

logs:
  docker compose --env-file .env logs -f --tail=200

ps:
  docker compose --env-file .env ps

# 本地开发中间件：PostgreSQL、RabbitMQ、MinIO
dev-infra-up:
  docker compose -f zhiying-infra-main/compose.yaml up -d

dev-infra-down:
  docker compose -f zhiying-infra-main/compose.yaml down

backend-check:
  cd zhiying-backend-main && cargo fmt --check && cargo check

frontend-check:
  cd zhiying-frontend-main && pnpm exec tsc --noEmit && pnpm lint

mock-check:
  cd zhiying-mock-main && uv run python -m compileall -q src


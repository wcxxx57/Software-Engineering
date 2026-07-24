default:
  @just --list

# 校验生产 Compose 配置（需要根目录 .env）
config:
  docker compose --env-file .env config --quiet

# 启动唯一的真实四消费者版本
up:
  docker compose --env-file .env -f compose.yaml -f compose.local.yaml up -d --build

down:
  docker compose --env-file .env -f compose.yaml -f compose.local.yaml down

logs:
  docker compose --env-file .env -f compose.yaml -f compose.local.yaml logs -f --tail=200

ps:
  docker compose --env-file .env -f compose.yaml -f compose.local.yaml ps

backend-check:
  cd backend && cargo fmt --check && cargo check

frontend-check:
  cd frontend && pnpm exec tsc --noEmit && pnpm lint

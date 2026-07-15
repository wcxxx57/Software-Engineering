#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ! -f .env ]]; then
  echo "missing .env; copy .env.example and fill production values first" >&2
  exit 1
fi

export IMAGE_TAG="${1:-${IMAGE_TAG:-latest}}"

docker compose \
  --env-file .env \
  -f compose.yaml \
  -f compose.prod.yaml \
  config --quiet

docker compose \
  --env-file .env \
  -f compose.yaml \
  -f compose.prod.yaml \
  pull

docker compose \
  --env-file .env \
  -f compose.yaml \
  -f compose.prod.yaml \
  up -d --remove-orphans

docker compose \
  --env-file .env \
  -f compose.yaml \
  -f compose.prod.yaml \
  ps

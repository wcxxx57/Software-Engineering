#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ! -f .env ]]; then
  echo "missing .env; copy .env.example and fill production values first" >&2
  exit 1
fi

if grep -Eiq '=(.*please-change|.*change-me|.*replace-me|.*sk-change|example\.com)' .env; then
  echo "unsafe placeholder value found in .env; replace all example credentials first" >&2
  exit 1
fi

export IMAGE_TAG="${1:-${IMAGE_TAG:-latest}}"

docker compose \
  --env-file .env \
  -f compose.yaml \
  -f compose.prod.yaml \
  config --quiet

compose=(docker compose --env-file .env -f compose.yaml -f compose.prod.yaml)
backup_dir="${BACKUP_DIR:-$(pwd)/backups}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

if "${compose[@]}" ps --status running --services | grep -qx postgres; then
  backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_tmp="$backup_dir/postgres-predeploy-$backup_stamp.sql.tmp"
  backup_path="$backup_dir/postgres-predeploy-$backup_stamp.sql"
  echo "creating PostgreSQL backup: $backup_path"
  "${compose[@]}" exec -T postgres sh -c \
    'exec pg_dump --clean --if-exists -U "$POSTGRES_USER" "$POSTGRES_DB"' \
    >"$backup_tmp"
  if [[ ! -s "$backup_tmp" ]]; then
    echo "PostgreSQL backup is empty; deployment aborted" >&2
    rm -f "$backup_tmp"
    exit 1
  fi
  mv "$backup_tmp" "$backup_path"
  chmod 600 "$backup_path"
else
  echo "PostgreSQL is not running; skipping pre-deploy backup (expected on first deploy)"
fi

"${compose[@]}" pull

"${compose[@]}" up -d --remove-orphans

"${compose[@]}" ps

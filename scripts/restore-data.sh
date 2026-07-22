#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: RESTORE_CONFIRM=restore-postgres-and-minio $0 <backup-directory>" >&2
  exit 2
fi
if [ "${RESTORE_CONFIRM:-}" != "restore-postgres-and-minio" ]; then
  echo "Refusing destructive restore. Set RESTORE_CONFIRM=restore-postgres-and-minio." >&2
  exit 2
fi

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BACKUP_DIR=$(CDPATH= cd -- "$1" && pwd)
cd "$ROOT_DIR"

test -f "$BACKUP_DIR/manifest.json"
test -f "$BACKUP_DIR/postgres/database.dump"
test -f "$BACKUP_DIR/SHA256SUMS"
(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)

docker compose stop knowledge-video-bridge code-video-bridge core-generation backend

docker compose exec -T postgres sh -ec '
  dropdb --if-exists --force --username="$POSTGRES_USER" "$POSTGRES_DB"
  createdb --username="$POSTGRES_USER" "$POSTGRES_DB"
'
docker compose exec -T postgres sh -ec '
  exec pg_restore --no-owner --no-privileges --exit-on-error \
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"
' < "$BACKUP_DIR/postgres/database.dump"

ABS_MINIO_SOURCE=$(CDPATH= cd -- "$BACKUP_DIR/minio" && pwd)
docker compose run --rm --no-deps --entrypoint /bin/sh \
  -v "$ABS_MINIO_SOURCE:/restore:ro" minio-init -ec '
    mc alias set target http://minio:9000 "$STORAGE_ACCESS_KEY" "$STORAGE_SECRET_KEY"
    mc mirror --overwrite --remove /restore "target/$STORAGE_BUCKET"
  '

docker compose up -d backend core-generation knowledge-video-bridge code-video-bridge
echo "Restore completed from: $BACKUP_DIR"

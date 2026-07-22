#!/usr/bin/env sh
set -eu

# Creates one coordinated PostgreSQL + MinIO backup set. The application
# writers are quiesced by default so the database references and object set
# describe the same maintenance window.

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BACKUP_ROOT=${BACKUP_ROOT:-"$ROOT_DIR/backups"}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$BACKUP_ROOT/$STAMP"
QUIESCE_BACKUP=${QUIESCE_BACKUP:-true}
STOPPED=false

case "$QUIESCE_BACKUP" in
  true|false) ;;
  *) echo "QUIESCE_BACKUP must be true or false" >&2; exit 2 ;;
esac

mkdir -p "$DEST/postgres" "$DEST/minio"
cd "$ROOT_DIR"

resume_services() {
  if [ "$STOPPED" = true ]; then
    docker compose up -d backend core-generation knowledge-video-bridge code-video-bridge
  fi
}
trap resume_services EXIT INT TERM

if [ "$QUIESCE_BACKUP" = true ]; then
  docker compose stop knowledge-video-bridge code-video-bridge core-generation backend
  STOPPED=true
fi

docker compose exec -T postgres sh -ec '
  exec pg_dump --format=custom --no-owner --no-privileges \
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"
' > "$DEST/postgres/database.dump"

ABS_MINIO_DEST=$(CDPATH= cd -- "$DEST/minio" && pwd)
docker compose run --rm --no-deps --entrypoint /bin/sh \
  -v "$ABS_MINIO_DEST:/backup" minio-init -ec '
    mc alias set source http://minio:9000 "$STORAGE_ACCESS_KEY" "$STORAGE_SECRET_KEY"
    mc mirror --overwrite "source/$STORAGE_BUCKET" /backup
  '

DB_SIZE=$(wc -c < "$DEST/postgres/database.dump" | tr -d ' ')
OBJECT_COUNT=$(find "$DEST/minio" -type f | wc -l | tr -d ' ')
cat > "$DEST/manifest.json" <<EOF
{
  "schema_version": 1,
  "created_at_utc": "$STAMP",
  "quiesced": $QUIESCE_BACKUP,
  "postgres_database": "${POSTGRES_DB:-unknown}",
  "storage_bucket": "${STORAGE_BUCKET:-zhiying-content}",
  "database_dump": "postgres/database.dump",
  "database_bytes": $DB_SIZE,
  "minio_directory": "minio",
  "minio_object_count": $OBJECT_COUNT
}
EOF

(cd "$DEST" && find postgres minio -type f -print0 | sort -z | xargs -0 -r sha256sum > SHA256SUMS)

resume_services
STOPPED=false
trap - EXIT INT TERM
echo "Backup completed: $DEST"

#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_ROOT="${BACKUP_ROOT:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_ROOT%/}/${STAMP}"
TMP="${TARGET}.partial"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Production env file not found: $ENV_FILE" >&2
  exit 1
fi

# Never overlap backup/restore against the same working production stack.
exec 9>"${MAINTENANCE_LOCK:-.sudoku-maintenance.lock}"
if ! flock -n 9; then
  echo "Another production maintenance operation is running" >&2
  exit 1
fi

compose=(docker compose --env-file "$ENV_FILE" -f compose.yaml -f compose.production.yaml)

mkdir -p "$BACKUP_ROOT"
if [[ -e "$TMP" || -e "$TARGET" ]]; then
  echo "Backup target already exists; refusing to overwrite: $TARGET" >&2
  exit 1
fi
mkdir -p "$TMP/objects"
chmod 700 "$BACKUP_ROOT" "$TMP" "$TMP/objects"

restart_apps() {
  "${compose[@]}" up -d api worker beat web caddy >/dev/null
}
recover_after_backup() {
  local result=$?
  if ! restart_apps; then
    echo "[backup] application restart failed; operator recovery required" >&2
    result=1
  fi
  exit "$result"
}
trap recover_after_backup EXIT

echo "[backup] entering maintenance mode"
"${compose[@]}" stop caddy web api worker beat >/dev/null
"${compose[@]}" up -d postgres minio minio-init >/dev/null

echo "[backup] PostgreSQL"
"${compose[@]}" exec -T postgres   pg_dump -U sudoku -d sudoku --format=custom --no-owner --no-acl   > "$TMP/postgres.dump"

OBJECTS_ABS="$(cd "$TMP/objects" && pwd)"
echo "[backup] encrypted object store"
"${compose[@]}" run --rm --no-deps   -v "$OBJECTS_ABS:/backup"   --entrypoint /bin/sh minio-init -c '
    set -eu
    attempt=0
    until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
      attempt=$((attempt + 1))
      if [ "$attempt" -ge 60 ]; then echo "Object store did not become ready" >&2; exit 1; fi
      sleep 1
    done
    mc mirror --overwrite "local/$S3_BUCKET" /backup
  '

cat > "$TMP/manifest.txt" <<EOF
created_utc=$STAMP
git_commit=$(git rev-parse HEAD 2>/dev/null || printf unknown)
database=postgresql
object_store=minio
EOF

(
  cd "$TMP"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

mv "$TMP" "$TARGET"
trap - EXIT
restart_apps

echo "[backup] complete: $TARGET"
echo "[backup] copy this directory to encrypted off-host storage"

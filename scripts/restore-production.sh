#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${1:-}"
RESTORE_CONFIRM="${RESTORE_CONFIRM:-}"

if [[ "$RESTORE_CONFIRM" != "YES" ]]; then
  echo "Refusing restore. Set RESTORE_CONFIRM=YES explicitly." >&2
  exit 2
fi
if [[ -z "$BACKUP_DIR" || ! -d "$BACKUP_DIR" ]]; then
  echo "Usage: RESTORE_CONFIRM=YES $0 <backup-directory>" >&2
  exit 2
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Production env file not found: $ENV_FILE" >&2
  exit 1
fi
if [[ ! -f "$BACKUP_DIR/postgres.dump" || ! -f "$BACKUP_DIR/SHA256SUMS" ]]; then
  echo "Backup is incomplete: $BACKUP_DIR" >&2
  exit 1
fi

(
  cd "$BACKUP_DIR"
  sha256sum -c SHA256SUMS
)

compose=(docker compose --env-file "$ENV_FILE" -f compose.yaml -f compose.production.yaml)

restart_apps() {
  "${compose[@]}" up -d api worker beat web caddy >/dev/null
}

restore_failed() {
  status=$?
  trap - EXIT
  echo "[restore] FAILED after entering maintenance mode; application services remain stopped." >&2
  echo "[restore] Inspect PostgreSQL and object-store state, then recover explicitly before restarting traffic." >&2
  exit "$status"
}

echo "[restore] entering maintenance mode"
"${compose[@]}" stop caddy web api worker beat >/dev/null
trap restore_failed EXIT
"${compose[@]}" up -d postgres minio minio-init >/dev/null

echo "[restore] PostgreSQL"
"${compose[@]}" exec -T postgres   psql -U sudoku -d postgres -v ON_ERROR_STOP=1   -c "DROP DATABASE IF EXISTS sudoku WITH (FORCE);"   -c "CREATE DATABASE sudoku OWNER sudoku;"
"${compose[@]}" exec -T postgres   pg_restore -U sudoku -d sudoku --no-owner --no-acl --exit-on-error   < "$BACKUP_DIR/postgres.dump"

OBJECTS_ABS="$(cd "$BACKUP_DIR/objects" && pwd)"
echo "[restore] encrypted object store"
"${compose[@]}" run --rm --no-deps   -v "$OBJECTS_ABS:/backup:ro"   --entrypoint /bin/sh minio-init -c '
    set -eu
    until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do sleep 1; done
    mc rm --recursive --force "local/$S3_BUCKET" >/dev/null 2>&1 || true
    mc mirror --overwrite /backup "local/$S3_BUCKET"
  '

restart_apps
trap - EXIT
echo "[restore] complete"

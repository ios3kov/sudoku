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
if [[ ! -s "$BACKUP_DIR/postgres.dump" || ! -s "$BACKUP_DIR/SHA256SUMS" || ! -f "$BACKUP_DIR/manifest.txt" || ! -d "$BACKUP_DIR/objects" ]]; then
  echo "Backup is incomplete: $BACKUP_DIR" >&2
  exit 1
fi

(
  cd "$BACKUP_DIR"
  if [[ -n "$(find . -type l -print -quit)" ]]; then
    echo "Backup must not contain symbolic links" >&2
    exit 1
  fi
  sha256sum -c SHA256SUMS
  # Reject missing/unlisted files too, before entering maintenance or dropping DB.
  actual="$(find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum)"
  if [[ "$actual" != "$(cat SHA256SUMS)" ]]; then
    echo "Backup inventory does not match its checksum manifest" >&2
    exit 1
  fi
)

# Never overlap backup/restore against the same working production stack.
exec 9>"${MAINTENANCE_LOCK:-.sudoku-maintenance.lock}"
if ! flock -n 9; then
  echo "Another production maintenance operation is running" >&2
  exit 1
fi

compose=(docker compose --env-file "$ENV_FILE" -f compose.yaml -f compose.production.yaml)

# Once maintenance begins, failure must leave the application offline. Restarting
# a half-restored database/object pair risks exposing or accepting inconsistent data.
maintenance_started=false
on_exit() {
  local result=$?
  if (( result != 0 )) && [[ "$maintenance_started" == true ]]; then
    "${compose[@]}" stop caddy web api worker beat >/dev/null 2>&1 || true
    echo "[restore] failed; applications left in maintenance. Inspect and recover before restarting." >&2
  fi
  exit "$result"
}
trap on_exit EXIT

echo "[restore] entering maintenance mode"
maintenance_started=true
"${compose[@]}" stop caddy web api worker beat >/dev/null
"${compose[@]}" up -d postgres minio minio-init >/dev/null

echo "[restore] PostgreSQL"
"${compose[@]}" exec -T postgres   psql -U sudoku -d postgres -v ON_ERROR_STOP=1   -c "DROP DATABASE IF EXISTS sudoku WITH (FORCE);"   -c "CREATE DATABASE sudoku OWNER sudoku;"
"${compose[@]}" exec -T postgres   pg_restore -U sudoku -d sudoku --no-owner --no-acl --single-transaction --exit-on-error   < "$BACKUP_DIR/postgres.dump"

OBJECTS_ABS="$(cd "$BACKUP_DIR/objects" && pwd)"
echo "[restore] encrypted object store"
"${compose[@]}" run --rm --no-deps   -v "$OBJECTS_ABS:/backup:ro"   --entrypoint /bin/sh minio-init -c '
    set -eu
    attempt=0
    until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
      attempt=$((attempt + 1))
      if [ "$attempt" -ge 60 ]; then echo "Object store did not become ready" >&2; exit 1; fi
      sleep 1
    done
    mc rm --recursive --force "local/$S3_BUCKET" >/dev/null
    mc mirror --overwrite /backup "local/$S3_BUCKET"
  '

"${compose[@]}" up -d api worker beat web caddy >/dev/null
trap - EXIT
echo "[restore] complete"

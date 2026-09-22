#!/usr/bin/env bash
# Backup only: resume the same application containers; never reconcile MinIO.
set -Eeuo pipefail
umask 077

BASE=1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b
ENV_FILE="$(pwd)/.env.production"
stage=preflight
maintenance=0
record=not-created
declare -A ids images infra_state
services=(postgres redis minio api worker beat web caddy)
apps=(api worker beat web caddy)

die() { echo "STOP: $*" >&2; exit 1; }
dc=(docker compose --env-file "$ENV_FILE" -f compose.yaml -f compose.production.yaml)

unchanged() {
  local service
  for service in "${services[@]}"; do
    [[ "$(docker inspect -f '{{.Id}} {{.Image}}' "sudoku-${service}-1")" == "${ids[$service]} ${images[$service]}" ]] || return 1
  done
  for service in postgres redis minio; do
    [[ "$(docker inspect -f '{{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}' "${ids[$service]}")" == "${infra_state[$service]}" ]] || return 1
  done
}

resume_existing() {
  local service attempt healthy=0
  unchanged || { echo 'STOP: container identity/infrastructure changed; manual recovery required' >&2; return 1; }
  docker start "${ids[api]}" >/dev/null || return 1
  for ((attempt=0; attempt<90; attempt++)); do
    if [[ "$(docker inspect -f '{{.State.Status}} {{.State.Health.Status}}' "${ids[api]}")" == 'running healthy' ]]; then
      healthy=1
      break
    fi
    sleep 2
  done
  (( healthy )) || { echo 'STOP: baseline API did not become healthy' >&2; return 1; }
  for service in worker beat web; do
    docker start "${ids[$service]}" >/dev/null || return 1
  done
  sleep 3
  for service in api worker beat web; do
    [[ "$(docker inspect -f '{{.State.Status}}' "${ids[$service]}")" == running ]] || return 1
  done
  docker start "${ids[caddy]}" >/dev/null || return 1
  APP_DOMAIN=sudoku.moscow bash scripts/smoke-production.sh || return 1
  unchanged
}

finish() {
  local rc=$?
  trap - EXIT HUP INT TERM
  if (( maintenance )); then
    echo '[recovery] resuming the original application containers'
    if ! resume_existing; then
      docker stop --time 30 "${ids[caddy]}" >/dev/null 2>&1 || echo 'WARNING: could not close original public proxy' >&2
      echo 'RECOVERY_REQUIRED: public proxy left stopped where possible; do not deploy' >&2
      rc=1
    fi
  fi
  if (( rc )); then
    echo "BACKUP_STOP stage=$stage record=$record; PIN not deployed" >&2
  fi
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' HUP INT TERM

for command in docker git flock python3 sha256sum find sort xargs; do
  command -v "$command" >/dev/null || die "missing command: $command"
done
[[ "$(git rev-parse HEAD)" == "$BASE" ]] || die 'unexpected checkout; do not automatically change it'
[[ -z "$(git status --porcelain)" ]] || die 'local changes found'
exec 8>.sudoku-maintenance.lock
flock -n 8 || die 'another maintenance operation is running'
ENV_FILE="$ENV_FILE" bash scripts/preflight-production.sh

for service in "${services[@]}"; do
  name="sudoku-${service}-1"
  ids[$service]=$(docker inspect -f '{{.Id}}' "$name")
  images[$service]=$(docker inspect -f '{{.Image}}' "$name")
  [[ "${ids[$service]}" =~ ^[a-f0-9]{64}$ && "${images[$service]}" =~ ^sha256:[a-f0-9]{64}$ ]] || die "invalid identity: $service"
  [[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}' "$name")" == "sudoku $service" ]] || die "wrong service: $service"
  [[ "$(docker inspect -f '{{.State.Status}}' "$name")" == running ]] || die "service is not running: $service"
done
for service in postgres redis; do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "${ids[$service]}")" == healthy ]] || die "$service is not healthy"
done
for service in postgres redis minio; do
  infra_state[$service]=$(docker inspect -f '{{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}' "${ids[$service]}")
done
[[ "$(docker exec "${ids[postgres]}" psql -X -U sudoku -d sudoku -Atqc 'SELECT version_num FROM alembic_version')" == 0014_mls_device_rekey ]] || die 'unexpected database revision'

# Only the separate mc helper image must be locally available. The running
# MinIO server image is deliberately never resolved, retagged, or replaced.
mc_image=$(docker image inspect -f '{{.Id}}' sudoku-minio-init) || die 'local mc helper image is unavailable'
[[ "$mc_image" =~ ^sha256:[a-f0-9]{64}$ ]] || die 'invalid mc helper identity'
[[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$mc_image")" == RELEASE.2025-08-13T08-35-41Z ]] || die 'unexpected mc helper version'

mkdir -p "$HOME/sudoku-release-records"
record=$(mktemp -d "$HOME/sudoku-release-records/pin-backup-XXXXXXXX")
partial="$record/backup.partial"
backup="$record/backup"
mkdir -p "$partial/objects"
for service in "${services[@]}"; do
  printf '%s\t%s\t%s\n' "$service" "${ids[$service]}" "${images[$service]}" >> "$record/containers.tsv"
done
printf 'services:\n  minio-init:\n    image: "%s"\n    build: !reset null\n    pull_policy: never\n' "$mc_image" > "$record/mc.yaml"
helper=("${dc[@]}" -f "$record/mc.yaml")
"${helper[@]}" config --format json | python3 -c '
import json,sys
s=json.load(sys.stdin)["services"]["minio-init"]
assert s["image"] == sys.argv[1] and not s.get("build") and s["pull_policy"] == "never"
' "$mc_image"

# Validate access BEFORE the maintenance window. The helper only reads S3.
"${helper[@]}" run --rm --no-deps --pull never -T --entrypoint /bin/sh minio-init -c '
  set -eu
  mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1
  mc stat "local/$S3_BUCKET" >/dev/null
' > "$record/helper-preflight.log" 2>&1
unchanged || die 'infrastructure changed during preflight'

stage=quiesce
maintenance=1
echo '[1/4] Temporary maintenance: stopping application writers only'
for service in caddy beat worker web api; do
  docker stop --time 60 "${ids[$service]}" >/dev/null
done
for service in "${apps[@]}"; do
  [[ "$(docker inspect -f '{{.State.Status}}' "${ids[$service]}")" == exited ]] || die "writer did not stop: $service"
  [[ "$(docker inspect -f '{{.State.ExitCode}}' "${ids[$service]}")" != 137 ]] || die "forced shutdown: $service"
done
unchanged || die 'infrastructure changed before backup'

stage=database
echo '[2/4] PostgreSQL dump and structural check'
docker exec "${ids[postgres]}" pg_dump -U sudoku -d sudoku --format=custom --no-owner --no-acl > "$partial/postgres.dump"
[[ -s "$partial/postgres.dump" ]] || die 'empty database dump'
docker exec -i "${ids[postgres]}" pg_restore -l < "$partial/postgres.dump" >/dev/null

stage=objects
echo '[3/4] Copy current objects through S3; MinIO remains running'
"${helper[@]}" run --rm --no-deps --pull never -T -v "$partial/objects:/backup" --entrypoint /bin/sh minio-init -c '
  set -eu
  mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1
  mc mirror --overwrite "local/$S3_BUCKET" /backup
' > "$record/object-copy.log" 2>&1
unchanged || die 'infrastructure changed while copying'
# The stack must remain quiescent until BOTH stores have been copied.
for service in "${apps[@]}"; do
  [[ "$(docker inspect -f '{{.State.Status}}' "${ids[$service]}")" == exited ]] || die "writer resumed during backup: $service"
done
printf 'created_utc=%s\ngit_commit=%s\ndatabase=postgresql\nobject_store=minio\nmethod=quiesced-current-objects\nrestore_tested=false\n' "$(date -u +%FT%TZ)" "$BASE" > "$partial/manifest.txt"
(cd "$partial"; find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS; sha256sum --status -c SHA256SUMS)
mv "$partial" "$backup"

stage=resume
echo '[4/4] Resume the same application containers and run live smoke'
# On failure the EXIT handler makes one recovery attempt and reports failure.
resume_existing
maintenance=0
printf 'checkout=%s\nbackup=%s\nverified_utc=%s\n' "$BASE" "$backup" "$(date -u +%FT%TZ)" > "$record/result.txt"
echo "BACKUP_EXISTING_OK $backup"
echo "RELEASE_RECORD $record"
echo 'PIN_NOT_DEPLOYED; off-host copy and restore acceptance remain separate'

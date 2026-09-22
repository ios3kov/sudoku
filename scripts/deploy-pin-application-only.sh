#!/usr/bin/env bash
# One bounded release: old baseline -> verified PIN + exec. Never reconcile MinIO.
set -Eeuo pipefail
umask 077
BASE=1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b
TARGET=cb8eca6f80aec5febf1e86de13a43e831fdbfc35
stage=preflight
maintenance=0
migration_started=0
checkout_changed=0
policy_changed=0
record=not-created
declare -A ids images infra_state built
services=(postgres redis minio api worker beat web caddy)
apps=(api worker beat web)
die() { echo "STOP: $*" >&2; exit 1; }
field() { docker inspect -f "$2" "$1"; }
dc=(docker compose --env-file "$(pwd)/.env.production" -f compose.yaml -f compose.production.yaml)

infra_unchanged() {
  local s
  for s in postgres redis minio; do
    [[ "$(field "sudoku-$s-1" '{{.Id}} {{.Image}}')" == "${ids[$s]} ${images[$s]}" ]] || return 1
    [[ "$(field "${ids[$s]}" '{{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}')" == "${infra_state[$s]}" ]] || return 1
  done
}
originals_unchanged() {
  local s
  for s in "${services[@]}"; do
    [[ "$(field "sudoku-$s-1" '{{.Id}} {{.Image}}')" == "${ids[$s]} ${images[$s]}" ]] || return 1
  done
  infra_unchanged
}
wait_api() {
  local container=$1 n
  for ((n=0; n<90; n++)); do
    [[ "$(field "$container" '{{.State.Status}} {{.State.Health.Status}}')" == 'running healthy' ]] && return 0
    sleep 2
  done
  return 1
}
restore_policy() {
  (( policy_changed )) || return 0
  local policy
  [[ "$(field sudoku-api-1 '{{.Id}} {{.Image}}')" == "${ids[api]} ${images[api]}" ]] || return 1
  policy=$(field "${ids[api]}" '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.RestartPolicy.MaximumRetryCount}}') || return 1
  [[ "$policy" == 'no 0' || "$policy" == 'unless-stopped 0' ]] || return 1
  docker update --restart=unless-stopped "${ids[api]}" >/dev/null || return 1
  [[ "$(field "${ids[api]}" '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.RestartPolicy.MaximumRetryCount}}')" == 'unless-stopped 0' ]] || return 1
  policy_changed=0
}
resume_baseline() {
  local s
  # This function is forbidden after even an attempted PIN migration.
  (( migration_started == 0 )) || return 1
  originals_unchanged || return 1
  git checkout --detach "$BASE" >/dev/null || return 1
  docker start "${ids[api]}" >/dev/null || return 1
  restore_policy || return 1
  wait_api "${ids[api]}" || return 1
  for s in worker beat web; do docker start "${ids[$s]}" >/dev/null || return 1; done
  for s in "${apps[@]}"; do [[ "$(field "${ids[$s]}" '{{.State.Status}}')" == running ]] || return 1; done
  docker start "${ids[caddy]}" >/dev/null || return 1
  APP_DOMAIN=sudoku.moscow bash scripts/smoke-production.sh || return 1
  originals_unchanged
}
close_edge() {
  [[ "${ids[caddy]:-}" =~ ^[a-f0-9]{64}$ ]] || return 1
  [[ "$(field sudoku-caddy-1 '{{.Id}}')" == "${ids[caddy]}" ]] || return 1
  docker stop --time 30 "${ids[caddy]}" >/dev/null
}
finish() {
  local rc=$?
  trap - EXIT HUP INT TERM
  if (( rc != 0 )); then
    if (( migration_started )); then
      close_edge || echo 'WARNING: closing the public proxy failed' >&2
      echo 'RECOVERY_REQUIRED: keep PIN-aware source; no automatic rollback or restore' >&2
    elif (( maintenance )); then
      echo '[recovery] resuming original baseline containers'
      if ! resume_baseline; then
        restore_policy || echo 'WARNING: API restart policy needs operator recovery' >&2
        close_edge || echo 'WARNING: closing the public proxy failed' >&2
        echo 'RECOVERY_REQUIRED: baseline recovery failed' >&2
      fi
    elif (( checkout_changed )); then
      git checkout --detach "$BASE" >/dev/null || echo 'WARNING: checkout recovery failed' >&2
    fi
    echo "PIN_DEPLOY_STOP stage=$stage record=$record" >&2
  fi
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' HUP INT TERM

[[ $# == 1 ]] || die 'usage: deploy-pin-application-only.sh <successful-backup-record>'
for cmd in docker git python3 sha256sum flock curl find sort xargs; do command -v "$cmd" >/dev/null || die "missing command: $cmd"; done
[[ "$(git rev-parse HEAD)" == "$BASE" ]] || die 'unexpected checkout; do not retry blindly'
[[ -z "$(git status --porcelain)" ]] || die 'local modifications'
exec 8>.sudoku-maintenance.lock
flock -n 8 || die 'another maintenance operation is running'
prior=$1
[[ "$prior" == "$HOME"/sudoku-release-records/pin-backup-* && -s "$prior/result.txt" ]] || die 'successful backup record required'
grep -Fxq "checkout=$BASE" "$prior/result.txt" || die 'backup checkout mismatch'
grep -Fxq "backup=$prior/backup" "$prior/result.txt" || die 'backup path mismatch'
grep -Fxq "git_commit=$BASE" "$prior/backup/manifest.txt" || die 'backup baseline mismatch'
grep -Fxq 'method=quiesced-current-objects' "$prior/backup/manifest.txt" || die 'not a quiesced backup'
(cd "$prior/backup" && sha256sum --status -c SHA256SUMS) || die 'backup checksum failure'
[[ -s "$prior/backup/postgres.dump" && -d "$prior/backup/objects" ]] || die 'incomplete backup'

for s in "${services[@]}"; do
  ids[$s]=$(field "sudoku-$s-1" '{{.Id}}')
  images[$s]=$(field "sudoku-$s-1" '{{.Image}}')
  [[ "${ids[$s]}" =~ ^[a-f0-9]{64}$ && "${images[$s]}" =~ ^sha256:[a-f0-9]{64}$ ]] || die "invalid identity: $s"
  grep -Fxq "$(printf '%s\t%s\t%s' "$s" "${ids[$s]}" "${images[$s]}")" "$prior/containers.tsv" || die "container changed since backup: $s"
  [[ "$(field "${ids[$s]}" '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}')" == "sudoku $s" ]] || die "wrong service: $s"
  [[ "$(field "${ids[$s]}" '{{.State.Status}}')" == running ]] || die "not running: $s"
done
for s in postgres redis api; do [[ "$(field "${ids[$s]}" '{{.State.Health.Status}}')" == healthy ]] || die "unhealthy: $s"; done
for s in postgres redis minio; do infra_state[$s]=$(field "${ids[$s]}" '{{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}'); done
[[ "$(docker exec "${ids[postgres]}" psql -X -U sudoku -d sudoku -Atqc 'SELECT version_num FROM alembic_version')" == 0014_mls_device_rekey ]] || die 'unexpected database revision'
[[ "$(field "${ids[api]}" '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.RestartPolicy.MaximumRetryCount}}')" == 'unless-stopped 0' ]] || die 'unexpected API restart policy'
# MinIO is deliberately excluded: its historical image is absent, its container remains intact.
for s in "${apps[@]}"; do [[ "$(docker image inspect -f '{{.Id}}' "${images[$s]}")" == "${images[$s]}" ]] || die "baseline image unavailable: $s"; done
mc=$(docker image inspect -f '{{.Id}}' sudoku-minio-init)
[[ "$mc" =~ ^sha256:[a-f0-9]{64}$ ]] || die 'invalid mc image'
[[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "$mc")" == RELEASE.2025-08-13T08-35-41Z ]] || die 'unexpected mc image version'

ENV_FILE=.env.production bash scripts/preflight-production.sh
git fetch origin main
git merge-base --is-ancestor "$TARGET" origin/main
git diff --quiet "$BASE" "$TARGET" -- infra compose.production.yaml || die 'unexpected infrastructure changes'
record=$(mktemp -d "$HOME/sudoku-release-records/pin-rollout-XXXXXXXX")
cp "$prior/containers.tsv" "$record/baseline-containers.tsv"
printf 'base=%s\ntarget=%s\nprior_backup=%s\n' "$BASE" "$TARGET" "$prior/backup" > "$record/intent.txt"
git show "$TARGET:scripts/legacy-api-signal.py" > "$record/legacy-api-signal.py"
printf '%s  %s\n' bd068e4d441aed45db2530ef7d07dea0c8ecf40486cc04057931148f52f3575c "$record/legacy-api-signal.py" | sha256sum --status -c -
docker exec -i "${ids[api]}" python - --check < "$record/legacy-api-signal.py"
for s in "${apps[@]}"; do
  tag="sudoku-recovery/$s:${record##*/}"
  docker image tag "${images[$s]}" "$tag"
  [[ "$(docker image inspect -f '{{.Id}}' "$tag")" == "${images[$s]}" ]] || die 'recovery tag verification failed'
done
printf 'services:\n  minio-init:\n    image: "%s"\n    build: !reset null\n    pull_policy: never\n' "$mc" > "$record/mc.yaml"
helper=("${dc[@]}" -f "$record/mc.yaml")
"${helper[@]}" config --format json | python3 -c 'import json,sys;s=json.load(sys.stdin)["services"]["minio-init"];assert s["image"]==sys.argv[1] and not s.get("build") and s["pull_policy"]=="never"' "$mc"
"${helper[@]}" run --rm --no-deps --pull never -T --entrypoint /bin/sh minio-init -c 'set -eu; mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; mc stat "local/$S3_BUCKET" >/dev/null' > "$record/helper-check.log" 2>&1

stage=build
echo '[1/5] Build the exact application release; current site stays running'
checkout_changed=1
git checkout --detach "$TARGET"
ENV_FILE=.env.production bash scripts/preflight-production.sh
"${dc[@]}" build api worker beat web
printf 'services:\n' > "$record/target-images.yaml"
for s in "${apps[@]}"; do
  built[$s]=$(docker image inspect -f '{{.Id}}' "sudoku-$s")
  [[ "${built[$s]}" =~ ^sha256:[a-f0-9]{64}$ ]] || die "invalid built image: $s"
  printf '  %s:\n    image: "%s"\n    build: !reset null\n    pull_policy: never\n' "$s" "${built[$s]}" >> "$record/target-images.yaml"
  printf '%s\t%s\n' "$s" "${built[$s]}" >> "$record/target-images.tsv"
done
new=("${dc[@]}" -f "$record/target-images.yaml")
"${new[@]}" config --format json | python3 -c 'import json,sys;c=json.load(sys.stdin);expected=dict(line.strip().split("\t") for line in open(sys.argv[1]));assert all(c["services"][s]["image"]==v and not c["services"][s].get("build") and c["services"][s]["pull_policy"]=="never" for s,v in expected.items())' "$record/target-images.tsv"
originals_unchanged || die 'container or infrastructure changed during build'
[[ "$(git rev-parse HEAD)" == "$TARGET" && -z "$(git status --porcelain)" ]] || die 'source changed during build'

stage=quiesce
maintenance=1
echo '[2/5] Temporary maintenance; graceful shutdown of original applications'
for s in caddy beat worker web; do
  docker stop --time 60 "${ids[$s]}" >/dev/null
  [[ "$(field "${ids[$s]}" '{{.State.Status}}')" == exited && "$(field "${ids[$s]}" '{{.State.ExitCode}}')" != 137 && "$(field "${ids[$s]}" '{{.State.OOMKilled}}')" == false ]] || die "unclean stop: $s"
done
policy_changed=1
docker update --restart=no "${ids[api]}" >/dev/null
[[ "$(field "${ids[api]}" '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.RestartPolicy.MaximumRetryCount}}')" == 'no 0' ]] || die 'API restart was not disabled'
signal_time=$(date -u +%FT%TZ)
docker exec -i "${ids[api]}" python - --terminate < "$record/legacy-api-signal.py"
for ((n=0; n<60; n++)); do [[ "$(field "${ids[api]}" '{{.State.Status}}')" == exited ]] && break; sleep 1; done
[[ "$(field "${ids[api]}" '{{.State.Status}}')" == exited && "$(field "${ids[api]}" '{{.State.OOMKilled}}')" == false ]] || die 'API did not exit cleanly'
api_exit=$(field "${ids[api]}" '{{.State.ExitCode}}')
[[ "$api_exit" == 0 || "$api_exit" == 143 ]] || die "unclean API exit: $api_exit"
docker logs --since "$signal_time" "${ids[api]}" > "$record/api-shutdown.log" 2>&1
grep -q 'Application shutdown complete' "$record/api-shutdown.log" && grep -q 'Finished server process' "$record/api-shutdown.log" || die 'missing API shutdown evidence'
echo API_GRACEFUL_STOP_OK

stage=backup
echo '[3/5] Fresh paired backup immediately before migration'
partial="$record/backup.partial"
mkdir -p "$partial/objects"
docker exec "${ids[postgres]}" pg_dump -U sudoku -d sudoku --format=custom --no-owner --no-acl > "$partial/postgres.dump"
[[ -s "$partial/postgres.dump" ]] || die 'empty database dump'
docker exec -i "${ids[postgres]}" pg_restore -l < "$partial/postgres.dump" >/dev/null
"${helper[@]}" run --rm --no-deps --pull never -T -v "$partial/objects:/backup" --entrypoint /bin/sh minio-init -c 'set -eu; mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; mc mirror --overwrite "local/$S3_BUCKET" /backup' > "$record/object-copy.log" 2>&1
for s in api worker beat web caddy; do [[ "$(field "${ids[$s]}" '{{.State.Status}}')" == exited ]] || die "writer resumed: $s"; done
originals_unchanged || die 'infrastructure changed during backup'
printf 'created_utc=%s\ngit_commit=%s\ntarget_commit=%s\ndatabase=postgresql\nobject_store=minio\nmethod=quiesced-current-objects\nrestore_tested=false\n' "$(date -u +%FT%TZ)" "$BASE" "$TARGET" > "$partial/manifest.txt"
(cd "$partial"; find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS; sha256sum --status -c SHA256SUMS)
mv "$partial" "$record/backup"
echo "BACKUP_OK $record/backup"

stage=migration
echo '[4/5] Migrate PIN schema, then replace only API/worker/beat/web'
[[ "$(docker exec "${ids[postgres]}" psql -X -U sudoku -d sudoku -Atqc 'SELECT version_num FROM alembic_version')" == 0014_mls_device_rekey ]] || die 'database changed before migration'
# From this boundary, never resume an old API that would ignore active PIN locks.
migration_started=1
"${new[@]}" run --rm --no-deps --pull never -T api alembic upgrade head
[[ "$(docker exec "${ids[postgres]}" psql -X -U sudoku -d sudoku -Atqc 'SELECT version_num FROM alembic_version')" == 0015_session_pins ]] || die 'PIN migration not confirmed'
"${new[@]}" up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api
"${new[@]}" up -d --no-deps --no-build --pull never --wait --wait-timeout 180 worker beat web

stage=verification
echo '[5/5] Verify images, process boundary, scheduler and public endpoints'
sleep 20
for s in "${apps[@]}"; do
  [[ "$(field "sudoku-$s-1" '{{.Image}}')" == "${built[$s]}" ]] || die "wrong running image: $s"
  [[ "$(field "sudoku-$s-1" '{{.State.Status}} {{.RestartCount}}')" == 'running 0' && "$(field "sudoku-$s-1" '{{.State.OOMKilled}}')" == false ]] || die "unstable service: $s"
  [[ "$(field "sudoku-$s-1" '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.RestartPolicy.MaximumRetryCount}}')" == 'unless-stopped 0' ]] || die "unexpected restart policy: $s"
done
wait_api sudoku-api-1 || die 'new API unhealthy'
docker exec sudoku-api-1 python -c 'from pathlib import Path; args=Path("/proc/1/cmdline").read_bytes().split(b"\0"); assert b"/bin/sh" not in args and b"/usr/local/bin/uvicorn" in args and b"app.main:app" in args; print("API_EXEC_OK")'
for s in beat worker; do
  docker logs --since=60s --tail=300 "sudoku-$s-1" > "$record/$s.log" 2>&1
  if grep -Eq 'PermissionError|Traceback|ERROR|CRITICAL' "$record/$s.log"; then die "error in $s logs (kept private in release record)"; fi
done
grep -q 'Task app.tasks.outbox.dispatch_outbox_batch.*succeeded' "$record/worker.log" || die 'no successful worker dispatch observed'
infra_unchanged || die 'infrastructure changed during rollout'
[[ "$(field sudoku-caddy-1 '{{.Id}} {{.Image}}')" == "${ids[caddy]} ${images[caddy]}" ]] || die 'proxy identity changed'
docker start "${ids[caddy]}" >/dev/null
APP_DOMAIN=sudoku.moscow bash scripts/smoke-production.sh
[[ "$(curl -sS --connect-timeout 5 --max-time 15 -o /dev/null -w '%{http_code}' https://sudoku.moscow/v1/auth/device-access)" == 401 ]] || die 'device-access endpoint check failed'
infra_unchanged || die 'infrastructure changed after smoke'
[[ "$(git rev-parse HEAD)" == "$TARGET" ]] || die 'checkout changed'
printf 'commit=%s\nbackup=%s\nverified_utc=%s\nmanual_pin_acceptance=pending\nrestore_tested=false\n' "$TARGET" "$record/backup" "$(date -u +%FT%TZ)" > "$record/result.txt"
maintenance=0
"${new[@]}" ps -a
echo "PIN_DEPLOY_OK $TARGET"
echo "RELEASE_RECORD $record"

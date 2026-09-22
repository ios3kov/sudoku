# Step80 — backup around an unavailable historical MinIO image

Date: 2026-09-22. Scope: correct the operator backup path after the PIN rollout stopped during preflight. This helper does **not** deploy PIN or change the application candidate.

## Observed failure

The operator supplied `STOP: image unavailable or changed: minio`, `DEPLOY_STOP stage=preflight record=/home/deploy/sudoku-release-records/pin-bMN2EkHq`, and `No such image: sha256:d247575e9ce5fe6bdb01e357468c22859fa747160ccedf873d882c66c8886b9e`. The previously provided deployment block stopped before backup, migration, checkout or service switching. Its earlier preflight can create a record directory and recovery tags for preceding services; do not claim there were no filesystem or Docker-tag changes whatsoever.

The missing image is the image recorded on the existing MinIO container, not evidence of lost volumes or a stopped service. Fresh running state must be checked before operations. The ordinary `scripts/backup-production.sh` invokes Compose `up` for infrastructure and application recovery; simply deleting its image guard could accidentally recreate MinIO from another local tag. That path is not appropriate for this incident.

## Revised operation and acceptance

Run `scripts/backup-existing-production.sh` from the existing `/home/deploy/sudoku` checkout at `1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b`, without checking out the ops branch. The PIN candidate remains `5205a4add164fdf84702afea870040413e5acfb9`; main is unchanged by this helper work.

The helper acquires the existing maintenance lock, checks the baseline checkout/schema and configuration, and records exact container IDs/images. PostgreSQL, Redis and MinIO must be running; PostgreSQL/Redis must be healthy. Only a separate locally available mc helper image is resolved, with its expected pinned version. A temporary Compose override removes that helper's build configuration and pins its exact image digest with pull policy never. S3 access is checked before downtime.

During the backup window, the existing Caddy, beat, worker, web and API containers are stopped gracefully. PostgreSQL, Redis, MinIO and their volumes are never stopped, replaced or recreated. The script dumps PostgreSQL and copies current object data through the S3 API while application writers remain stopped; it validates dump structure and checksums before promoting the partial backup. No raw archive of the running MinIO filesystem is used.

It resumes the exact original application container IDs with Docker start, waits for API health, opens the original proxy last, and runs the baseline live smoke. Infrastructure IDs/images/start timestamps/restart counts are checked for unexpected changes. It never invokes Compose up/down/build/restart, removes original containers/volumes, resolves the historical MinIO server image, runs a migration, changes checkout, or automatically rolls back a PIN-aware API.

On a copy/stop error, it attempts to resume the same original application containers but still returns failure; no incomplete backup is promoted. If recovery or live smoke fails, the original proxy is left stopped where possible and `RECOVERY_REQUIRED` is reported. No success is claimed for such a result. Advisory locks cannot prevent unrelated administrators or external writers; the operator must not run concurrent maintenance or direct S3 writes during this window.

## Verification performed here

- Bash syntax check passed.
- Python test source compiled.
- Fourteen fake-Docker control-flow tests passed in two seven-test groups. They cover the observed unavailable original MinIO image, successful quiesced-copy ordering, no infrastructure recreation, private backup directory/checksums, wrong schema, missing helper, helper connectivity failure, failed/empty/invalid dump, mirror failure, partial/forced stop, unexpected writer resumption, changed infrastructure, recovery failure and failed smoke.
- The test harness deliberately rejects attempts to resolve the missing historical server image or mutate infrastructure. Initial harness startup overhead was localized to Python site initialization; a lightweight system-Python invocation was used instead. The command timeout was not raised to mask an application failure.
- Separate source review checked error traps, exact-ID recovery, helper image pinning, no external secret printing, backup promotion ordering and no accidental deploy. The public operator bootstrap uses an immutable ops commit, not a moving branch checkout.

Docker/Compose and PostgreSQL/MinIO are not available in the local execution environment. These are **control-flow simulations**, not an actual Docker integration run, production backup, successful restore or new application-CI result. Runtime Compose override validation, helper connectivity and live smoke remain mandatory in the operator run. The existing application's CI333 is not evidence that this new helper was container-tested.

## Handoff and boundaries

Expected output after the operator executes the helper: `BACKUP_EXISTING_OK <directory>`, `RELEASE_RECORD <directory>` and `PIN_NOT_DEPLOYED`. Until that output is provided, the new backup is pending. Keep object logs, dump files and backup contents private; share only status/error summaries. A failure before maintenance leaves services untouched; a recovery failure requires diagnosis rather than rerunning a rollout blindly.

This copies the current object contents expected by the repository recovery format, not historical S3 versions, full bucket/IAM configuration or a complete server image. It relies on the configured single production stack with no independent writers. It does not itself make an encrypted off-host copy or prove restoration. Off-host storage, controlled restore and physical-user acceptance remain separate.

After a successful operator backup, prepare the application-only PIN rollout with the same preserved infrastructure: build and replace only api/worker/beat/web, apply `0015_session_pins` before exposing PIN controls, preserve exact identity and PIN-aware failure handling, then run live acceptance. Do not rerun the earlier all-service-image guard/standard-backup monolith or use Compose up on the unchanged infrastructure as a shortcut.

References: [Step79](79-device-pin-merge.md), [production runbook](../PRODUCTION.md), Docker's start/run/up CLI documentation, and MinIO's mc mirror reference. This ops branch is not merged into main by this step.

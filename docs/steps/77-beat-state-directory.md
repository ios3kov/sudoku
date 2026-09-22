# Step 77 — non-root Celery beat state directory

Date: 2026-09-22. Tracks [issue #38](https://github.com/ios3kov/sudoku/issues/38).

## Confirmed incident and scope

The operator regained SSH access and supplied production evidence: checkout `33f17fe`, clean tracked worktree, 28 GB available; beat reported 2,154 restarts, user `sudoku`, working directory `/srv/api`, no OOM, and `PermissionError: [Errno 13] Permission denied: 'celerybeat-schedule'`. A momentary running/exit-zero snapshot was taken between crashes, not evidence of stable operation. The checkout does not prove each running image's source identity.

The earlier candidate `24f1152f24e5f9d661866ce30ffafe3ce550cd33` has the same configuration defect. CI313 built its images but did not start beat. Its successful historical gate must not be used to deploy this known-broken scheduler unchanged.

Deployment remains authorized. Scope is this confirmed runtime/configuration defect, its regression coverage and release documentation. No new product feature, root service, world-writable source directory, dependency, task frequency, message format, database migration or authentication/firewall change.

## Specification and implementation

The shared API image prepares `/var/lib/sudoku-beat` owned by its existing `sudoku` user with mode `0700`. Application code stays root-owned and not writable by the service user. Base Compose gives beat an explicit `--schedule=/var/lib/sudoku-beat/celerybeat-schedule` and a dedicated `beat-data` named volume. The production override retains dropped capabilities and no-new-privileges. Docker initializes a fresh volume using the image directory's permissions; the runtime test checks this rather than assuming it.

The volume preserves last-run bookkeeping across container recreation. It contains scheduler metadata, not chat messages or authoritative outbox data. Keep exactly one beat instance. Do not replace the volume with a root-owned bind mount, use `nocopy`, or repair permissions with `chmod 777`. Future image changes must preserve compatible UID ownership. PostgreSQL and encrypted objects remain the authoritative backup/restore pair; scheduler metadata is reconstructible and resetting it resets periodic-task timing, including the six-hour cleanup interval. This change does not add an automatic metadata reset or destructive restore.

Work order: confirm operator exception; reproduce old filesystem behavior; specify persistent non-root storage; implement narrow Docker/Compose fix; add unit/configuration and actual-container regression; separate review; run new runtime CI and existing full CI; merge only after exact-head success; verify post-merge; then operator preflight/backup/deployment and live acceptance.

## Verification and limitations

Local checks actually executed at authoring: five configuration-guard unit tests; Python syntax; YAML parsing; baseline Dockerfile/Compose blob-hash comparison; real Python 3.13 shelve red/green under uid 65534. A root-owned cwd reproduces PermissionError; a private owned directory writes and reopens state across processes. These are not local Docker/Celery execution: Docker/Celery and network access are unavailable in this isolated local environment.

New `beat-runtime` CI builds the actual production API image and resolves the actual production Compose command/mounts. `tests/ops/beat_runtime.py` checks:

- the old command without the schedule flag still reproduces the permission failure (negative control);
- fresh Docker volume ownership/mode and actual non-root UID, with `/srv/api` remaining non-writable;
- actual outbox task envelopes arrive in a uniquely isolated Redis instance without container restarts;
- graceful shutdown, schedule-file readability and preservation of counters/long-period timing across container removal and recreation.

Only synthetic settings are used, with an internal test network, no host-published ports and uniquely named test resources cleaned up on exit. No production endpoint, database, private message, worker execution or physical device is involved. Broker publication is not proof of worker processing or end-to-end user delivery. The existing full CI stays unchanged and mandatory. At this document's authoring checkpoint, remote CI is pending; exact terminal SHA/run evidence belongs in the fix PR and issue #38, not inferred from this paragraph.

## Deployment and recovery boundary

After both PR gates and post-merge gates pass, use the exact corrected application SHA recorded in the PR, not the superseded `24f1152f` or an arbitrary moving ref. Run host preflight, capture existing image/checkout rollback evidence, and complete a backup before replacing application services. The first deployment must use the corrected image and new volume together. A Compose-only update against an old image can create a root-owned state volume and is not a valid rollout. Never `docker compose down -v`, blindly prune images/volumes, or automatically downgrade/restore the database.

Because the operator's stack mixes image ages and already has a failing beat, do not claim its old checkout is a fully healthy rollback. Preserve actual old image IDs separately. Backup scripts restart application services; do not rebuild moving application tags before a backup that may call `compose up`, or the backup could inadvertently start the new image. Use the corrected backup script with the still-current Compose/worktree first, then check out/build/deploy the corrected candidate. Stop on failed backup, preflight, build or smoke.

After rollout: verify exactly one beat container is stable with unchanged restart count across observations, no permission exceptions, periodic dispatches received and successfully handled by worker, API/live-edge smoke and exact deployed identity. Do not close issue #38 on CI alone. Installed iOS/Android, two-device encrypted flow and real restore remain the separately deferred Step70 acceptance. This assistant still has no authenticated production shell; operator commands and their returned results are deployment evidence.

## Primary references

- https://docs.celeryq.dev/en/stable/userguide/periodic-tasks.html#starting-the-scheduler
- https://docs.docker.com/engine/storage/volumes/

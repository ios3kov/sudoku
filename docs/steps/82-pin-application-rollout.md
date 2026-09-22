# Step82 — paired backup succeeded; application-only PIN rollout

Date: 2026-09-22. Continue the user-authorized deployment. The operator's authenticated Mac SSH session executes production commands; repository access does not give the assistant control of that terminal. No production migration or PIN rollout is claimed until the operator supplies terminal verification.

## Operator checkpoint

The operator ran the reviewed helpers from `46f034a9dc1026df0e26bf331effb40ebbf584ac` and reported `LEGACY_API_TARGET_OK pid=8`, `LEGACY_API_TERM_SENT pid=8`, `API_GRACEFUL_STOP_OK`, PostgreSQL dump/structure check, current-object S3 copying, original-container resume and successful baseline live smoke. Terminal record:

```text
BACKUP_EXISTING_OK /home/deploy/sudoku-release-records/pin-backup-xx0ewVFO/backup
RELEASE_RECORD /home/deploy/sudoku-release-records/pin-backup-xx0ewVFO
PIN_NOT_DEPLOYED
```

This closes the reported backup attempt under that helper's stopped-writer, checksum, identity and restart-policy guards. It is operator evidence, not an independent host inspection, an encrypted off-host copy or a restore test. PostgreSQL/Redis/MinIO were preserved. Baseline checkout/schema remain `1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b` / `0014_mls_device_rekey` according to the helper's guards. Do not reuse the earlier running-volume tar as an equivalent recovery point.

## Reviewed application candidate

PR #42 was squash-merged as `cb8eca6f80aec5febf1e86de13a43e831fdbfc35`. Its tree `24931a5ec43e89fe5ba8c1cb854b1e722705f04b` exactly equals reviewed PR head `46f034a9dc1026df0e26bf331effb40ebbf584ac`. Review `5280783709` was read and no unresolved inline review threads were returned. All four PR gates passed, including CI335 after a diagnosed PyPI network timeout was rerun without weakening the audit.

The exact merged application has successful post-merge checks:

| Workflow | Run | Job | Observed result |
| --- | --- | --- | --- |
| Full CI | [35768953835](https://github.com/ios3kov/sudoku/actions/runs/35768953835) | `106885494943` | completed / success, all required steps and cleanup |
| device-access | [35768953593](https://github.com/ios3kov/sudoku/actions/runs/35768953593) | `106885493826` | completed / success |
| beat-runtime | [35768953933](https://github.com/ios3kov/sudoku/actions/runs/35768953933) | `106885494880` | completed / success |
| api-shutdown | [35768953711](https://github.com/ios3kov/sudoku/actions/runs/35768953711) | `106885494305` | completed / success |

Full CI includes API/migrations, audits, OpenMLS, lint/types, lifecycle/storage/operations, member/admin PIN and existing browser acceptance, web budget, infrastructure validation and final production application images. The conditional failure-artifact upload alone was skipped. These are source/CI checks, not actual production PIN acceptance. The new candidate supersedes `5205a4ad...` for this release because it also fixes the API launch command. There is no new PIN/auth/schema/dependency change in PR #42 beyond the previously merged PIN feature; the existing runtime correction is `exec` before Uvicorn after migrations.

## Standalone operator script

`../../scripts/deploy-pin-application-only.sh` lives on the separate `ops/pin-application-rollout` branch with `../../tests/ops/test_pin_rollout.py`. This operational wrapper is not merged into main and is not a different application release. It always builds/deploys immutable application `cb8eca6f80aec5febf1e86de13a43e831fdbfc35`, not its own ops commit.

Extract the wrapper from the reviewed immutable ops commit without checking out that branch. Run it from `/home/deploy/sudoku`, passing the successful backup record above. It revalidates that backup and all recorded container identities, baseline schema and health, original API restart policy, available baseline application images, pinned mc helper, source ancestry and production preflight. It deliberately never resolves or retags the missing historical MinIO server image. Application recovery image tags are created before rebuilding.

The wrapper builds only api/worker/beat/web while the current application runs. It then records exact built image IDs and uses an image-pinned, build-disabled Compose override for migration and rollout. The override is validated through the installed Compose before downtime. Local default tags cannot silently substitute another target image after this capture.

In the maintenance window, stop the original edge and application writers; signal the verified legacy Uvicorn child using the same SHA-verified pidfd helper that just worked for the operator. Temporarily disable only the old API restart policy. Retain no-force, OOM and positive shutdown-marker guards. Create a fresh paired DB/current-object copy immediately before migration, so messages added since the prior backup are included. Keep writers stopped across both copies; check hashes and infrastructure identity before promoting the backup.

Apply `0015_session_pins` with a one-off pinned API container before starting PIN-enabled clients. Both Compose up calls use `--no-deps --no-build --pull never` and select only application services. PostgreSQL/Redis/MinIO and their volumes are never stopped, recreated or reconciled. Caddy is restarted by its recorded original ID, not replaced. No down, volume deletion, prune, broad kill, schema downgrade or destructive restore is present.

## Failure and rollback boundary

Before any migration attempt, a failed build restores the source checkout; a failed maintenance/backup attempts to restore the original baseline containers and the API restart policy. Recovery failures keep the edge closed where possible and report `RECOVERY_REQUIRED`. Newly built image tags and private diagnostic records can remain; do not claim zero filesystem/image changes.

From immediately before the migration command onward, no legacy API or old checkout is automatically restored. A pre-PIN server could ignore active PIN restrictions. On any subsequent failure, close the original edge and retain PIN-aware source for forward recovery. If the old API still exists after a failed migration attempt, its restart policy can intentionally remain disabled: do not blindly start it or restore a pre-PIN policy. A deliberate rollback requires a separately controlled session-revocation/password-reauthentication plan, not reuse of the image tags as an automatic rollback command.

After success, verify running application image IDs, healthy API, zero observed restarts/OOM, restored new-container restart policies, Uvicorn as PID1, bounded beat/worker logs, successful outbox task execution, unchanged infrastructure, baseline live smoke and unauthenticated device-access rejection (401). Empty outbox jobs are not a real message-delivery proof. Required terminal marker is `PIN_DEPLOY_OK`, not merely a record directory or a backup marker. Do not rerun the wrapper after `PIN_DEPLOY_STOP` without diagnosis.

## Verification of the wrapper

Executed locally: initial red success-path test, implementation, Bash syntax, Python compilation, and nineteen fake-Docker scenarios across four unittest methods, repeated against the final matching source. Coverage: normal ordering and unchanged infrastructure; corrupted backup, changed identity, dirty checkout, missing application image and wrong process; build, forced writer, signal, missing shutdown markers, dump and object-copy failures; migration, API startup, infrastructure drift, restart, scheduler log, smoke and endpoint failures. Post-migration simulations reject any attempt to restart the old API. The harness also rejects infrastructure mutation, missing no-deps/no-build guards, destructive restore and prohibited broad cleanup. SHA-256 checks and filesystem output in these simulations use real local files; Docker/Git/HTTP behavior is simulated.

Separate source review inspected the before/after-migration recovery boundary, exact identities and image pinning, SQL migration ordering, same signal helper, graceful-stop evidence, stopped-writer backup, conditional error handling and private logs. No additional blocking finding remained. Published script/test blob hashes match reviewed local bytes. This review is by the assistant, not independent certification.

Local Docker, ShellCheck and Ruff are unavailable and a clone attempt failed DNS; no real Docker run, new application build or full CI pass is claimed for this standalone wrapper. The application's full CI and the previous real-container signal regression do not substitute for testing this wrapper on the host. Its runtime checks are mandatory. Tests are runnable with `python3 -m unittest discover -s tests/ops -p 'test_pin_rollout.py' -v` on an isolated checkout. Do not run those simulations as production verification.

## Handoff and retained work

The command causes a temporary application outage. Do not run parallel maintenance, a full-stack Compose up, or direct S3/DB writes during it. Preserve the private release directory and `target-images.yaml` for controlled recovery. Do not paste environment values, raw private logs, backup data or key material into chat/Git.

Until the operator reports `PIN_DEPLOY_OK`, the feature remains undeployed in this evidence log. After technical rollout, real member/admin PIN setup/change/removal, lock/unlock, wrong-attempt limits, password recovery, logout/revocation and encrypted-message flows still need live acceptance. Physical iOS/Android PWA, off-host encrypted backup and controlled actual restoration remain separate; no success is claimed for them.

References: [Step81](81-api-graceful-shutdown.md), [Step80](80-existing-stack-backup.md), [Step79](79-device-pin-merge.md), [production runbook](../PRODUCTION.md), [PR #42](https://github.com/ios3kov/sudoku/pull/42), and Docker's Compose up/run and container start documentation. The old generic all-service rollout/backup commands remain inappropriate for this host while its historical MinIO image is missing.

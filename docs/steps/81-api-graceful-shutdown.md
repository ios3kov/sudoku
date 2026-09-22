# Step81 — API signal delivery and legacy-stack backup

Date: 2026-09-22. Continue the authorized PIN release preparation without replacing the running MinIO container. This is a focused operational correction, not another global audit or permission to erase/recreate production infrastructure.

## Operator evidence and diagnosis

The current API reports `running`, `OOM=false`, zero restarts and launch argv `/bin/sh -c 'alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips=*'`. The observed tree is a shell with Uvicorn as its child. The previous backup stopped at the explicit exit-137 guard before either data copy; the original containers were resumed and baseline live smoke eventually passed.

The running topology confirms the missing exec/signal-delivery boundary in the source. Current OOM=false alone does not prove the cause of every historical kill. The separate real-container regression reproduces the legacy stop-timeout outcome and compares both corrective paths; its terminal result must be recorded before claiming it passed.

## Scope, design and acceptance

1. Permanent fix: add only `exec` before Uvicorn in the existing Compose API command. Migrations still run first; their failure still prevents serving. No password, PIN, MLS, database schema, dependency, image version or other service configuration change is needed. This changes the deployable source and therefore requires its own full exact-SHA CI, not reuse of PIN CI333.
2. Existing-container bridge: the revised backup uses `legacy-api-signal.py` inside the recorded API container. Before downtime and again before signalling, require the exact PID-1 shell command and exactly one direct child matching the complete Uvicorn argv. Use a pidfd and revalidate start identity so a recycled numeric PID cannot be targeted. Never use host PID numbers from pasted logs, broad pkill, PID-1 SIGKILL or privilege escalation.
3. Record and require the existing `unless-stopped` policy. Temporarily set only this API container to `no` before SIGTERM, keep it disabled across the paired DB/S3 copy, then restore and verify it when resuming the same container. On failure attempt recovery and policy restoration; a restoration failure is not a success. Unexpected concurrent policy/container changes fail closed rather than being overwritten.
4. Retain the 60-second bound, exit-137 and OOM guards. Require API exit 0 or 143 plus both Uvicorn completion log markers before dumping anything. Exit143 can follow Uvicorn's completed SIGTERM handling; the exit number by itself is not sufficient. No forced fallback and no increased timeout to conceal a failure.
5. All application writers stay stopped during the PostgreSQL dump and current-object S3 mirror. PostgreSQL/Redis/MinIO identities, start times and restart counts must remain unchanged. Never reconcile those services with Compose up. Resume the original applications, restore restart policy, expose the original proxy last and require baseline live smoke. A failed run must not print backup success.

The helper is intentionally limited to the previously verified pre-PIN checkout `1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b` and schema `0014_mls_device_rekey`. Extract the two scripts from an immutable reviewed ops commit into a private temporary directory; do not checkout this feature branch on production. The helper does not install the permanent launch fix or PIN.

## Verification checkpoint

Executed locally: Bash syntax and Python compilation; eight process-selection/pidfd unit tests; all 21 fake-Docker backup scenarios, covering the previous 14 conditions plus wrong process, targeted signal failure/timeout, API force/OOM termination, missing shutdown evidence and restart-policy restoration failure. Existing failure assertions are retained as table-driven subtests. Groups were run separately within tool execution limits; per-scenario timeout was not increased.

A new `api-shutdown` workflow builds the actual non-root API image and tests three disposable containers: legacy Docker stop must reproduce exit137 without lifespan completion, guarded child SIGTERM must complete and allow the same container/policy to resume, and the corrected exec command must run Uvicorn as PID1 and complete ordinary Docker stop. The fixture substitutes a synthetic ASGI app and migration stub; it validates real process and signal behavior, not a production DB migration or full application lifespan. Full repository CI separately retains API/migration/browser/crypto/build/operations coverage.

At this documentation checkpoint the real-container and full GitHub workflows are not yet completed; no pass is claimed. Local Docker is unavailable and the clone attempt failed DNS, so code is read/written through the authorized GitHub connector. Terminal exact-SHA workflow IDs and review belong in the PR and supersede this pending status without claiming production execution.

## Handoff and stop conditions

After successful helper verification, the next operator action is the revised backup, with a temporary outage and no simultaneous maintenance/direct S3 writes. Expected markers: `LEGACY_API_TARGET_OK`, `LEGACY_API_TERM_SENT`, `API_GRACEFUL_STOP_OK`, `BACKUP_EXISTING_OK`, `RELEASE_RECORD`, `PIN_NOT_DEPLOYED`. Keep raw logs, dumps and object contents private. If any guard or recovery fails, do not retry a deployment blindly.

No server command, restart-policy mutation, backup, migration or rollout was executed by the assistant in this step. The existing PIN candidate `5205a4ad...` is not a verification of the new Compose change. After the new reviewed candidate is merged and post-merge checks pass, use an application-only rollout that preserves MinIO and applies the PIN migration before exposure; never use a pre-PIN rollback that silently bypasses active PIN gates.

An off-host encrypted copy, actual restore exercise and physical iOS/Android/two-device acceptance remain separate. This is a current-object backup, not historical S3 version/IAM/server-image capture. See [Step80](80-existing-stack-backup.md), [Step79](79-device-pin-merge.md) and [production](../PRODUCTION.md).

Primary references: https://docs.docker.com/reference/dockerfile/#shell-form-entrypoint-example ; https://docs.docker.com/engine/containers/start-containers-automatically/ ; https://www.uvicorn.org/server-behavior/#graceful-process-shutdown .

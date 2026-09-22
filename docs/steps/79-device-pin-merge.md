# Step79 — device PIN merge and release handoff

Date: 2026-09-22. Scope: merge the reviewed feature, verify the exact merged application, update current documentation and stop before production deployment. No new feature, runtime fix or broad refactor is included.

## Acceptance and executed merge

The user instructed continuation after PR #40 reached ready-for-review status. Before merging, the connected GitHub API confirmed unchanged reviewed head `a2d86e2a5b1db458b5eff761583a2f6ff26d93d1`, unchanged main `1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b`, completed successful PR gates and no unresolved inline review threads. Source review `5279445059` was read; it is the assistant's separate review pass, not independent certification.

PR #40 was squash-merged with the expected-head guard at `2026-09-22T14:36:26Z`. Application candidate: `5205a4add164fdf84702afea870040413e5acfb9`. Its source tree `38c0e5ee3188d314272371457daf2b37e8128983` exactly equals the reviewed PR tree. No application code was altered during this step. The three tracked workflows test/build on a main push; none deploys production.

## Exact verification evidence

| Stage / workflow | Exact source SHA | Run | Result |
| --- | --- | --- | --- |
| PR CI #332 | `a2d86e2a5b1db458b5eff761583a2f6ff26d93d1` | [35738803026](https://github.com/ios3kov/sudoku/actions/runs/35738803026) | completed / success |
| PR device-access #15 | same PR head | [35738803218](https://github.com/ios3kov/sudoku/actions/runs/35738803218) | completed / success |
| PR beat-runtime #17 | same PR head | [35738803136](https://github.com/ios3kov/sudoku/actions/runs/35738803136) | completed / success |
| Main CI #333 | `5205a4add164fdf84702afea870040413e5acfb9` | [35741488200](https://github.com/ios3kov/sudoku/actions/runs/35741488200) | completed / success |
| Main device-access #16 | same merged application | [35741488216](https://github.com/ios3kov/sudoku/actions/runs/35741488216) | completed / success |
| Main beat-runtime #18 | same merged application | [35741488232](https://github.com/ios3kov/sudoku/actions/runs/35741488232) | completed / success |

Full PR CI job `106782840148` was re-read and all required steps succeeded. Post-merge jobs: full CI `106792089781`, device-access `106792090259`, beat-runtime `106792094923`. Only a completed successful exact-SHA run closes the merge gate; queued, pending, cancelled, failed or action-required states never count as success. Final decision: **the exact application post-merge gate is closed; production deployment is not performed or authorized by this step**. CI #333 completed successfully on attempt 1, with the run updated at `2026-09-22T14:50:35Z`.

All required main-push steps passed: API tests/migrations, OpenMLS, Python/Rust/npm audits, lint/typecheck, domain/lifecycle/storage/operations regressions, web build and bundle budget, member/admin PIN and existing browser acceptance, MinIO/Compose validation, final API/Web images and job cleanup. Only the failure-evidence upload was conditionally skipped. The separate device-access and beat-runtime jobs also completed successfully. No application correction or rerun was needed after the merge.

## Documentation and verification boundary

Update PROGRESS and PRODUCTION to distinguish the merged PIN candidate from the last operator-reported live version. Preserve the existing operational commands and infrastructure inventory; add PIN-specific backup/migration/rollback prerequisites before the generic deployment/rollback commands. This step's documentation changes only Markdown. Their published diff, UTF-8, fences, local links and exact identities must be checked before the documentation merge.

Application evidence is from GitHub Actions, not an unperformed local full suite. A local clone attempt failed DNS; no authenticated server shell was opened. Documentation-only commits may skip the duplicate full application suite but must not claim a new CI pass or substitute their SHA for the tested application candidate. Any subsequent application/test/dependency/workflow/build/infrastructure change needs its own verification.

## Deployment prerequisites and stop conditions

The PIN feature is merged, not deployed. Deployment needs separate authorization, authenticated administrator execution, successful exact-SHA gates, a fresh consistent DB/object backup, preserved rollback evidence and an explicit PIN-aware rollback plan. Reconfirm the actual running checkout/images before issuing host-specific commands; old local Docker tags were previously observed to differ from running images, and one running image could not be retagged.

The reviewed `scripts/backup-production.sh` enters maintenance mode and uses `docker compose up` both for dependencies and application recovery. It is not read-only and must not run against mismatched local image tags or a newly switched checkout as an accidental rollout. Verify the deployed baseline and recovery image references before changing checkout/build outputs; plan the maintenance window and encrypted off-host copy. This script was inspected, not executed.

The earlier no-restart backup passed `pg_restore -l` and checksums only. Its running-volume MinIO archive and separately timed DB dump do not prove cross-store consistency or restorability. Do not reuse it as a completed recovery gate or silently restore production. A controlled actual restore remains a separately authorized operation.

Migration `0015_session_pins` must be applied with the PIN-aware API before clients expose PIN setup. Four digits never replace the account password; recovery must preserve session/MLS identity. Once sessions enable PIN, a pre-PIN API would ignore that gate. Prefer a forward fix; any deliberate pre-PIN rollback must handle affected sessions through controlled revocation/password reauthentication. Do not blindly downgrade the database or erase MLS state for PIN recovery.

After separately authorized rollout, record running release identity and live smoke, then verify PIN setup/change/removal, reload/hide/background unlock, wrong-attempt lockout, password recovery and logout/revocation for member/admin. Preserve the separate physical iOS/Android PWA and real-two-device acceptance in [Step70](70-live-verification.md). No fresh backup, restore, migration, host restart, secret change or deployment ran in Step79.

## Retained limits and next action

PIN is online-only and low entropy, not MFA, offline encryption or protection against XSS/local browser/OS/server/database compromise. One active server capability is shared by tabs on a session; already authorized downloads cannot be recalled. Existing viewport/CSP/snapshot-storage tradeoffs remain. The prior empty-outbox worker execution is not an encrypted-message delivery proof.

Next action after the complete code gate: separately authorized deployment preparation following [PRODUCTION](../PRODUCTION.md), including consistent backup and PIN-safe rollback. Stop on mismatched source identity, changed unverified code, failed/pending CI, missing recovery evidence, failed preflight or live smoke. This handoff does not waive [Step70](70-live-verification.md).

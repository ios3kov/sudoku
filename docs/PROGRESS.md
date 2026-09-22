# Progress

## Current milestone — device PIN merged; release verification

Date: 2026-09-22. [PR #40](https://github.com/ios3kov/sudoku/pull/40) is merged as application candidate `5205a4add164fdf84702afea870040413e5acfb9`. The PIN feature has not been deployed by this step.

The merged source tree `38c0e5ee3188d314272371457daf2b37e8128983` exactly matches reviewed head `a2d86e2a5b1db458b5eff761583a2f6ff26d93d1`. All three PR workflows passed. [Step79](steps/79-device-pin-merge.md) records exact post-merge runs, their final decision, documentation checks and the next release boundary. Earlier pending/branch-only checkpoints in Step78 and the feature audit are historical; Step79 supersedes their status, not their limitations.

Included for both members and administrators: opt-in remembered email; four-digit PIN setup/change/removal; password recovery preserving the session/MLS identity; durable five-attempt lockout; a RAM-only unlock capability; protected HTTP/WebSocket and attachment access. [Step78](steps/78-device-pin-login.md) and [device-access design](features/device-access.md) remain the requirements and architecture references.

## Production and recovery baseline

The operator supplied successful deployment and live smoke output for `1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b`, including beat restart count `0 -> 0` and periodic empty outbox jobs. [Issue #38](https://github.com/ios3kov/sudoku/issues/38) records that bounded verification. It is not a fresh inspection of the running host, a real queued-message delivery test, or completion of [Step70](steps/70-live-verification.md).

The previous no-restart backup was structurally/checksum checked only. A raw archive of a running MinIO volume plus a separately timed DB dump does not establish a consistent database/object pair or successful restoration. A fresh consistent recovery point and a controlled restore drill remain required; no recovery success is claimed here.

## Next release boundary

Use [the production runbook](PRODUCTION.md) and Step79. Do not deploy on a pending/failed/mismatched exact-SHA gate. Production deployment requires separate authorization and authenticated administrator execution access; this merge neither deploys nor connects the assistant to the operator's terminal.

The PIN change adds migration `0015_session_pins`. Before exposing PIN-enabled clients, apply the migration with the PIN-aware API. Preserve rollback evidence and never fall back to a server that ignores active PIN requirements. No production command, backup, migration, restart, secret or infrastructure change ran in this step.

Physical iOS/Android installed-PWA acceptance, two-device encrypted direct/group/media/revocation flows, restart/reboot persistence and controlled restore remain open. Existing snapshot-write amplification, multi-tab behavior, CSP architecture and fixed-viewport accessibility tradeoffs are unchanged. Four-digit PIN is online-only, not MFA or an E2EE wrapping key.

Earlier audit/progress evidence remains in [the historical index](audits/progress-before-pr35-merge-2026-09-22.md), [Step75](steps/75-audit-merge-verification.md), [Step76](steps/76-deployment-access.md), [Step77](steps/77-beat-state-directory.md) and their PRs. Documentation-only follow-ups do not change the immutable application candidate above.

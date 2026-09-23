# Progress

## Current milestone — final interactive-control audit merged

Date: 2026-09-23. PR #49 is merged to `main` as `e47c4088a026f1100aed4d9d5526d82635bdb356`. It ports the earlier button audit onto the current phone/contact UI and adds regression coverage for the remaining controls: Sudoku Clear, phone change, Contacts add/remove/close, auth navigation/hide, password fallback, Notifications retry, Invite/Devices close, Sign out, encrypted media/file-picker controls and the previously covered conversation/message/group/security actions.

Reviewed head `fca76a9b54c6c965fe68050d7d1c9cbb723a1479` passed CI `35858047355`, device-access `35858047426`, beat-runtime `35858047382` and api-shutdown `35858047293`. Exact post-merge push verification for `e47c4088a026f1100aed4d9d5526d82635bdb356` is also green: CI `35859529252`, device-access `35859529261`, beat-runtime `35859529116`, api-shutdown `35859529199`.

PR #46 was closed unmerged as superseded. The current known web/PWA interactive-control QA debt is closed. See [Step86](steps/86-final-button-audit.md). Production deployment and the separate physical-device/two-device/recovery acceptance gates remain open.

## Current milestone — phone identity + contact graph merged

Date: 2026-09-23. PR #47 is merged to `main` as `9e0efdbe0e79efb99c3283e6c78784fe3a6325d0`. It moves the messenger to phone-first login and adds a server-enforced phone-book contact graph. New invite accounts are phone-bound; existing email accounts retain migration-only login until they assign a phone. Contact discovery exposes only active verified phone identities, and server authorization covers new direct/group chats, group additions and direct sends.

Reviewed code head `fdd5658473438a8a6617672cbb01389c6015c775` passed exact-head CI `35844463475`, device-access `35844463463`, beat-runtime `35844463482` and api-shutdown `35844463467`. Browser acceptance includes Contact Picker, manual fallback, Contacts removal, phone/PIN login and the existing E2EE recovery path. See [Step85](steps/85-phone-contacts.md).

Exact post-merge push verification for `9e0efdbe0e79efb99c3283e6c78784fe3a6325d0` is also green: CI `35846683142`, device-access `35846682972`, beat-runtime `35846683044`, api-shutdown `35846683074`.

Production has not been deployed. Migration `0016_phone_contacts`, legacy-phone verification and live mobile/PWA acceptance remain release steps.

## Current milestone — PIN onboarding + secure reload recovery merged

Date: 2026-09-23. PR #45 is merged to `main` as `9169a1a5456423515b288c5dfff7b72b7e5e9de1`. It moves optional PIN enrollment into the first successful password-login flow for members and administrators and fixes the OpenMLS stale-writer race observed across reload/pagehide. The existing server PIN schema, session UUID device identity and MLS wire format are unchanged.

The reload fix retires the old browser adapter synchronously before page destruction/background concealment so its unfinished async work cannot overwrite or conflict with a freshly rehydrated IndexedDB snapshot. The optimistic concurrency guard remains fail-closed. Browser acceptance proves a literal reload followed by PIN unlock returns to a fully ready secure-messaging runtime with no restart banner.

Exact post-merge push-to-main verification is green: CI `35825128577`, device-access `35825128686`, beat-runtime `35825128754`, and api-shutdown `35825128683`. Production deployment has not been performed for this follow-up. See [Step84](steps/84-pin-onboarding-reload-recovery.md).

## Previous milestone — device PIN production rollout

Date: 2026-09-23. [PR #40](https://github.com/ios3kov/sudoku/pull/40) was merged, and the production rollout completed on application commit `7ae408baf61f7fd978735773d82d038ce4d1cdc4`. [Step83](steps/83-pin-production-deploy.md) records the migration to `0015_session_pins`, service verification and production smoke. Manual UX acceptance remained open and led to the follow-up work in Step84.

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

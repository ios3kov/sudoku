# Progress

## Current milestone — native iOS production program

Date: 2026-09-24.

The phone/contact release is now live on production commit `c0f71313b92aaa8206eda036ecb819f796854f30`. Database migration `0016_phone_contacts` is applied, readiness is healthy, the live smoke passes, phone login works for the migrated administrator, and the four-digit PIN + reload path returns to secure messaging without the previous restart-required failure.

A consistent production backup `20260923T160722Z` was created with the maintenance backup script, its PostgreSQL dump and checksum manifest were verified, the live MinIO bucket contained zero objects, and the backup was copied to encrypted/off-host operator storage where checksums were verified again.

The next product track is a native iOS client shell rather than further PWA-only work. The target keeps the existing Next.js UI, FastAPI backend and MLS protocol while adding a narrow native capability layer for explicit iPhone contact selection, biometric unlock, app-switcher privacy and native media/file pickers. See [Step88](steps/88-native-ios-production-plan.md).

PR #62 is merged to `main` as `571ce04ad3903f76f7fbdbc1aa607acb767b9095`; exact post-merge CI, device-access, beat-runtime and api-shutdown are green. PR #65 is merged as `cd0d91657e0654a91c2e70f9c1400dd60b602059`, adding the first-party Swift/UIKit + WKWebView host, app-bound navigation, privacy cover, system Contacts picker bridge, XcodeGen project source and macOS/Xcode build gate. PR #67 is merged as `301ee0cc0719fac44d37c2c633734849b013a5da`, adding Secure Enclave P-256 Face ID / Touch ID challenge-response and migration `0018_session_biometrics`; it deliberately does not store the four-digit PIN. PR #69 is merged as `b6f7ac9cc185bb55a8ec476ec2daed9f204f198c`, adding system Photos/Files selection, the trusted native media bridge and `PrivacyInfo.xcprivacy`; exact post-merge `ci`, `ios-native`, `device-access`, `beat-runtime` and `api-shutdown` are green. Migration `0017_single_admin` and `0018_session_biometrics` remain repository-only until a separate production deployment gate. See [Step89](steps/89-ios-biometric-media.md) for the completed native media block and [Step90](steps/90-e2ee-send-state-reliability.md) for the merged durable send-state work.

PR #70 is merged as `32e869e10f8c14ae1caabda89e9d20c19e45200c`, adding explicit durable E2EE send states plus Retry/Remove and preserving one persisted ciphertext/client ID across recovery. PR #71 is merged as `8c57dc1942420a84147f742fa44a62dc36eab133`, adding bounded automatic transient retry while reusing the same durable ciphertext and `client_id`; reviewed exact head `7501cb7c0de15daef0b9b824bb5d905d5b34d9b0` passed CI `35979002030`, ios-native `35979002023`, api-shutdown `35979002060`, device-access `35979002048` and beat-runtime `35979002032`. The active P1 follow-up is [Step92](steps/92-voice-message-polish.md): local voice draft preview, waveform and scrub while keeping audio/metadata inside the existing E2EE path.

The global administration model is also being tightened: production remains invite-only and the database will enforce at most one global administrator. Only that singleton administrator may create or revoke account invitations. Conversation-local owner roles do not grant global invite rights.

Still open before a production iOS/App Store claim:
- second-account live invite/contact ACL verification;
- contact removal -> direct-send denial verification;
- two-device MLS direct/group/media/revocation acceptance;
- host reboot persistence;
- destructive PostgreSQL + encrypted-object restore drill;
- native iOS implementation, physical-device QA and TestFlight/App Store gates.

## Historical milestone — repository hygiene after final QA

Date: 2026-09-23. The remaining stale PR debt was cleaned after the final interactive-control audit. Old release-readiness PR #34 and obsolete Dependabot PRs #3–17 were closed without merge because they were based on superseded repository state and were no longer valid integration candidates.

Dependabot version updates are now grouped per ecosystem into routine (minor/patch) and major updates, with at most two open version-update PRs per ecosystem. Security updates are not disabled. This keeps future maintenance reviewable without hiding major compatibility work.

No production deployment was performed. See [Step87](steps/87-repository-hygiene.md).

## Historical milestone — final interactive-control audit merged

Date: 2026-09-23. PR #49 is merged to `main` as `e47c4088a026f1100aed4d9d5526d82635bdb356`. It ports the earlier button audit onto the current phone/contact UI and adds regression coverage for the remaining controls: Sudoku Clear, phone change, Contacts add/remove/close, auth navigation/hide, password fallback, Notifications retry, Invite/Devices close, Sign out, encrypted media/file-picker controls and the previously covered conversation/message/group/security actions.

Reviewed head `fca76a9b54c6c965fe68050d7d1c9cbb723a1479` passed CI `35858047355`, device-access `35858047426`, beat-runtime `35858047382` and api-shutdown `35858047293`. Exact post-merge push verification for `e47c4088a026f1100aed4d9d5526d82635bdb356` is also green: CI `35859529252`, device-access `35859529261`, beat-runtime `35859529116`, api-shutdown `35859529199`.

PR #46 was closed unmerged as superseded. The current known web/PWA interactive-control QA debt is closed. See [Step86](steps/86-final-button-audit.md). Production deployment and the separate physical-device/two-device/recovery acceptance gates remain open.

## Historical milestone — phone identity + contact graph merged

Date: 2026-09-23. PR #47 is merged to `main` as `9e0efdbe0e79efb99c3283e6c78784fe3a6325d0`. It moves the messenger to phone-first login and adds a server-enforced phone-book contact graph. New invite accounts are phone-bound; existing email accounts retain migration-only login until they assign a phone. Contact discovery exposes only active verified phone identities, and server authorization covers new direct/group chats, group additions and direct sends.

Reviewed code head `fdd5658473438a8a6617672cbb01389c6015c775` passed exact-head CI `35844463475`, device-access `35844463463`, beat-runtime `35844463482` and api-shutdown `35844463467`. Browser acceptance includes Contact Picker, manual fallback, Contacts removal, phone/PIN login and the existing E2EE recovery path. See [Step85](steps/85-phone-contacts.md).

Exact post-merge push verification for `9e0efdbe0e79efb99c3283e6c78784fe3a6325d0` is also green: CI `35846683142`, device-access `35846682972`, beat-runtime `35846683044`, api-shutdown `35846683074`.

Production has not been deployed. Migration `0016_phone_contacts`, legacy-phone verification and live mobile/PWA acceptance remain release steps.

## Historical milestone — PIN onboarding + secure reload recovery merged

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

# Progress

## Current work — remembered login and device PIN

Date: 2026-09-22. Feature branch: `feat/device-pin-login`, based on `1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b`. The user authorized implementation for both regular users and administrators. This feature has not been deployed.

[Step78](steps/78-device-pin-login.md) records the requirements/security design. [Device access](features/device-access.md) documents endpoints, client lifecycle, migration, limitations and verification. Exact reviewed PR/SHA/CI evidence belongs in the feature PR; pending checks are not successful checks.

Implemented on this branch: opt-in remembered email, session-bound four-digit PIN setup/change/removal, password recovery preserving session/MLS identity, durable five-attempt lockout, RAM-only unlock capability, protected HTTP/WebSocket access and attachment handling that does not forward the capability to object storage. Local client/transport tests and syntax checks passed; full PostgreSQL/API/browser/build CI remains the merge gate.

## Production baseline

The operator supplied successful deployment and live smoke output for `1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b`, including beat restart count `0 -> 0` and periodic outbox task execution by the worker. This closes the reported beat permission-loop incident, not all of [Step70](steps/70-live-verification.md). An empty outbox result is not a two-device encrypted-message delivery test.

The earlier no-restart backup was structurally/checksum checked only. A raw archive of a running MinIO volume plus a separately timed DB dump does not establish a consistent database/object pair or successful restoration. Do not describe it as a tested recovery point. Controlled consistent backup/restore acceptance remains open.

## Release boundary

The PIN change adds database migration `0015_session_pins`. Deploy only after exact candidate checks and review, with the API migration before PIN-enabled clients. Do not roll back to a server that ignores PIN requirements while retaining active PIN-enabled sessions. No production or infrastructure change was performed for this feature.

Retained separate acceptance: physical iOS/Android installed-PWA behavior, two-device encrypted direct/group/media/revocation flows, restart/reboot persistence and a controlled restore drill. Existing encrypted-snapshot write amplification, multi-tab conflict handling, CSP architecture and fixed-viewport accessibility tradeoffs remain documented; this feature does not certify or fix them.

Earlier audit/progress evidence is retained in [the historical index](audits/progress-before-pr35-merge-2026-09-22.md), [Step75](steps/75-audit-merge-verification.md), [Step76](steps/76-deployment-access.md), [Step77](steps/77-beat-state-directory.md) and their PRs.

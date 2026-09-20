# Progress

## Current milestone
Automated E2EE production code gate complete. Production deployment remains blocked only on physical-device and live-infrastructure verification.

## Verified E2EE baseline
Through Step 69 the repository has verified:
- MLS/RFC 9420 direct + group protocol via pinned OpenMLS 0.9.0 WASM;
- encrypted browser protocol state and crash-safe encrypted outbox;
- persistent session-bound device identities and single-use KeyPackages;
- race-safe same-device registration and serialized browser MLS initialization/KeyPackage startup;
- KeyPackage/group-member identity binding, TOFU pins and safety numbers;
- server activation coverage for every active participant MLS device;
- crash-safe direct/group bootstrap and resumable pending setup;
- encrypted message/edit/reaction/delete events;
- encrypted image/file/voice upload, local decrypt/render and integrity verification;
- deterministic encrypted-event projection and unified application/control ordering;
- reload/reconnect recovery solely through the unified transport cursor, preventing duplicate Welcome processing;
- MLS-aware group add/remove transitions with server prepare/finalize choreography;
- device/session add/revoke rekey reconciliation for existing encrypted groups;
- production API enforcement that new conversations are E2EE-only;
- safety-number verification UI with locally encrypted verified markers;
- Chromium reload/offline/retry/fail-closed browser acceptance.

## Automated verification
Full CI passed on commit `5b451e35`:
- Python compile and Alembic migrations ✓
- API integration tests ✓
- pinned OpenMLS Rust tests + WASM build ✓
- domain tests + declarations ✓
- web TypeScript check ✓
- Next production build ✓
- Chromium E2EE acceptance ✓
- production Compose merge/policy validation ✓

## Remaining production blockers
These require an actual deployment or physical devices and cannot be truthfully closed by repository CI:
- installed iOS PWA privacy/background + push + attachment/voice smoke;
- installed Android PWA privacy/background + push + attachment/voice smoke;
- live DNS/TLS verification;
- live PostgreSQL/Redis/S3 persistence and backup/restore verification;
- final deployed-host smoke test.

## Deployment rule
Do not call the service production-verified until the live/mobile checks above pass.

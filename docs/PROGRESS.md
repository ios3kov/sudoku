# Progress

## Current milestone
Global automated pre-production audit, polish and profiling are complete. The code-level production gate passed on commit `d082d984`.

The only remaining production gate is Step 70: physical iOS/Android and live-infrastructure verification.

## Verified E2EE baseline
Through Steps 69-71 the repository has verified:
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
- reload/reconnect recovery solely through the unified transport cursor;
- MLS-aware group add/remove transitions and device/session rekey reconciliation;
- production API enforcement that new conversations are E2EE-only;
- safety-number verification UI;
- immediate concealment/local MLS cleanup when a browser session is remotely revoked.

## Global pre-production audit
Step 71 closed the automated UX/UI, performance, security/privacy, accessibility, technical and operational findings that block deployment.

Key fixes:
- rebuilt the previously incomplete UI stylesheet as a responsive mobile-first design system;
- added safe-area handling, focus states, reduced-motion behavior and >=44px mobile interaction targets;
- added mobile UI overflow/keyboard/privacy acceptance;
- bounded long-chat DOM and lazy-decrypt encrypted media;
- released decrypted image/file memory when it is no longer needed;
- preserved scroll position while reading older messages during realtime updates;
- moved invite secrets from URL paths into JSON request bodies;
- hardened CSP/edge headers and browser egress;
- excluded `pending_add` members from asset authorization;
- hardened realtime membership/rate-limit/session-revocation behavior;
- made application containers non-root with dropped capabilities/no-new-privileges;
- made MinIO production routing, CORS and dedicated application credentials explicit;
- added production backup/restore scripts and protected local backups from Git;
- added canonical npm lockfile/reproducible installs.

## Automated verification
Full enhanced CI passed on code-gate commit `d082d984`:
- Python compile + Alembic migrations ✓
- Ruff Python lint ✓
- pip dependency audit ✓
- API integration tests: 11 passed ✓
- pinned OpenMLS Rust tests: 6 passed ✓
- OpenMLS WASM production build ✓
- RustSec audit: no known vulnerabilities ✓
- canonical `npm ci` ✓
- npm production dependency audit: 0 vulnerabilities ✓
- JSX/CSS UI contract: 103 classes checked ✓
- ESLint ✓
- domain tests + encrypted projection profiling ✓
- TypeScript declarations/typecheck ✓
- Next production build ✓
- web bundle/WASM performance budget ✓
- production-mode Chromium acceptance: 2 passed ✓
- backup/restore script validation ✓
- production Compose security-policy validation ✓
- real API and Web Docker image builds ✓
- non-root image users verified (`sudoku` / `node`) ✓

Measured profile:
- 10,000 encrypted events projected in 25.16 ms on the GitHub runner;
- production JS: 10 chunks, 207,793 bytes total gzip;
- largest JS chunk: 71,470 bytes gzip;
- OpenMLS WASM: 2,709,987 bytes raw;
- service worker: 2,546 bytes raw.

## Known non-blocking P2
- RustSec reports `proc-macro-error2 2.0.1` as unmaintained (RUSTSEC-2026-0173), pulled transitively through `hax-lib-macros 0.3.7`. No known vulnerability is reported. Dependency monitoring is enabled.
- The encrypted local journal is still persisted as part of the encrypted protocol-state blob. Projection CPU cost is low, but very large catch-up histories can create IndexedDB write amplification. Re-profile on physical mobile hardware before expanding beyond the invite-only MVP scale.

## Remaining production blockers
These require an actual deployment or physical devices and cannot be closed by repository CI:
- installed iOS PWA privacy/background + push + attachment/voice smoke;
- installed Android PWA privacy/background + push + attachment/voice smoke;
- live DNS/TLS and CSP verification;
- live PostgreSQL/Redis/MinIO persistence;
- a real PostgreSQL + encrypted-object backup/restore drill;
- final two-device encrypted smoke including remote session revocation.

## Deployment rule
Do not call the service production-verified until Step 70 passes.

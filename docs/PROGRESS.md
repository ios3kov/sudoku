# Progress

## Current milestone
Product polish 2.0 merged in PR #30 as `ff97e0f4ed476cd33be095a8814f90936849805a` after PR CI #276 passed. Post-merge CI #277 (run `35639832585`) then failed in the browser MLS transport-outage assertion; the merged release is therefore not recorded as passing its post-merge gate.

The active correction is Step 73 on `fix/secure-refresh-notifications`: retain refresh notifications received while a previous secure sync is finishing its read receipt, preserve decrypted history on failure, and clear the blocked-sync warning only after successful recovery. The isolated regression reproduces the lost notification; the corrected queue passes all seven regression tests. Full integrated CI for this correction remains a merge gate, not an assumed result.

The user reports the previously deployed build appears to work, but exact smoke evidence for the current release is not captured. Persistence/restore, two-device MLS and installed iOS/Android PWA checks remain open and intentionally deferred. This correction does not deploy production or apply the unfinished `feat/messenger-ux3` snapshot scripts.

## Verified E2EE baseline
Through Steps 69-72 the repository has verified:
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

## Structural refactor
Step 72 reduced high-risk file concentration without changing API, MLS lifecycle or visible behavior:
- `openmls-adapter.ts`: ~64.7 KB -> ~53.7 KB; state/codec and application-event codec extracted;
- `e2ee.py`: ~61.7 KB -> ~54.5 KB; request/validation/authorization helpers extracted;
- `routes/messaging.py`: ~36.9 KB -> ~31.5 KB; serialization/auth/outbox helpers extracted;
- shared chat title/voice helpers moved to `chat-utils.ts`;
- the ~66 KB API integration suite was split into core, MLS transport and MLS membership files;
- lifecycle-heavy orchestration was intentionally left intact to avoid pre-production ordering regressions.

## Step 70 deployment preparation
Live-gate preparation now includes:
- production Compose explicitly replaces the local Caddy port set so only 80/443 are host-published;
- CI asserts that PostgreSQL, Redis, MinIO, API, Worker, Beat and Web publish no host ports;
- `scripts/preflight-production.sh` validates Compose version, env-file permissions, required/independent secrets, VAPID key shape, E2EE policy, DNS and the final merged published-port boundary;
- `scripts/smoke-production.sh` verifies live DNS, certificate-valid HTTPS, API readiness, CSP/security headers, asset-host TLS and HTTP -> HTTPS redirects;
- `docs/steps/70-live-verification.md` defines the Selectel, persistence, destructive restore, two-device MLS and physical iOS/Android acceptance checklist;
- `docs/PRODUCTION.md` is the canonical non-secret production inventory/runbook for DNS, host, ports, SSH hardening, deploy, rollback and recovery.

These checks reduce deployment ambiguity but do not replace the actual live/physical Step 70 execution.

## Live Step 70 status
Verified on the Selectel production host:
- production commit `68211e02` started with API/PostgreSQL/Redis healthy and Web/Worker/Beat/MinIO/Caddy running;
- live smoke completed successfully for `sudoku.moscow`;
- external exposure from the administrator source is limited to 22/80/443; application/data ports 3000/5432/6379/8000/9000/9001 are closed;
- first administrator bootstrap completed through the hidden password prompt.

Current live findings:
- first MinIO registry pull blocker was fixed and CI-verified in PR #21;
- Web production image domain-workspace build blocker was fixed and CI-verified in PR #22;
- PR #25 corrected the hidden unlock so a held keypad digit 5 drives the **entire Sudoku surface** upward, revealing the real private surface underneath; incomplete drags spring back. Mobile digits remain one row, a stable puzzle number replaces `Level 1`, and the visible shell includes app branding plus timer/mistakes/progress;
- PR #25 also hardened overlapping MLS transport refresh/recovery and passed the full CI #245 gate before squash-merge to `6c0aefe9`;
- the first deploy attempt for `6c0aefe9` did not start because SSH was temporarily unreachable; administrator-source TCP/22 connectivity was subsequently re-confirmed. A successful deploy + live smoke for this SHA is still pending evidence;
- live iPhone gameplay exposed a CSS class collision: Sudoku invalid cells inherited the generic `.error` margin/padding/radius rules and could create thick dark grid bands; the fix moves Sudoku to a dedicated `.invalid` state and adds geometry acceptance;
- unlock completion is now intentionally set to 50% of the available upward path from digit 5 to the top edge; below 50%, release returns the whole Sudoku screen, and crossing 50% hands off to the finishing animation;
- mobile chat/login keeps a fixed viewport scale: inputs are 16px minimum and the viewport disallows focus-driven zoom/pinch scaling, so entering email/password must not resize the whole interface;
- two-device invite acceptance is not yet verified and remains part of the live gate.

Targeted unlock UX/performance work is documented in `docs/audits/sudoku-unlock-ux-2026-09-20.md`.

## Automated verification
Current status: PR #30 CI #276 passed; post-merge CI #277 failed the browser secure-outage assertion. API/OpenMLS, lint/typecheck/build and bundle checks passed in #277, while production operations/Compose/image steps after browser acceptance were skipped. Step 73 documents the correction and its separate local verification. Do not treat the historical checklist below as a current passing gate.

### Historical pre-production baseline
The release gate passed in PR #25 CI #245 before squash-merge to main SHA `6c0aefe95d02c3ee430904d3449ad6c8070cdf8b`. The broader enhanced pre-production gate also passed after refactor on code-gate commit `b84fc7ef`:
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

## Historical pre-Step-70 fixing closure
At the earlier pre-Step-70 checkpoint, repository cleanup was recorded as follows:
- obsolete bootstrap/CI verification PRs #1 and #2 are closed and are not part of the production path;
- there are no open repository issues and no open implementation PRs;
- no TODO/FIXME production blocker remains in the tracked source;
- the two known P2 items below are explicitly deferred rather than changed immediately: removing the RustSec maintenance warning requires changing the pinned OpenMLS/hax dependency chain, while changing encrypted-journal persistence would alter reload/crash-safety behavior. Both changes have higher pre-production regression risk than their current non-blocking impact.

This historical closure was reopened by post-merge CI #277. The Step 73 recovery correction requires the full automated gate before merging. Live/physical Step 70 remains deferred.

## Messenger redesign follow-up

PR #29 merged to main as `33f17fe5df3d4de124d391414c5b76adf6e0ac88` after CI #262 passed:
- the supplied 460 px mobile-first visual system is applied to the production messenger;
- a lightweight real-data reveal preview keeps OpenMLS/realtime initialization off the Sudoku drag critical path;
- conversation search, redesigned list/bubbles/composer and overlay drawers are live in the codebase;
- shared conversation header and isolated messenger CSS reduced presentation duplication;
- existing API, session, realtime, MLS, offline, attachment and voice behavior were preserved.

Product polish 2.0 merged in PR #30 and is tracked in `docs/audits/product-polish-2-2026-09-21.md`. Its post-merge recovery correction is tracked in `docs/steps/73-secure-refresh-recovery.md`.

## Deferred production verification
These still require live/physical verification, but the user has explicitly deferred this Step 70 work for now:
- capture exact live smoke evidence for the currently deployed release and perform the physical iPhone retest;
- diagnose/verify second-account invite acceptance;
- live PostgreSQL/Redis/MinIO persistence across stack restart and host reboot;
- a real PostgreSQL + encrypted-object backup/restore drill;
- final two-device encrypted smoke including remote session revocation;
- installed iOS PWA privacy/background + push + attachment/voice smoke;
- installed Android PWA privacy/background + push + attachment/voice smoke.

## Deployment rule
Do not call the service production-verified until Step 70 passes.

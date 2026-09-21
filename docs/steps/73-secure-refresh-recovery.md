# Step 73 — Retain secure refresh notifications

Date: 2026-09-21
Branch: `fix/secure-refresh-notifications`
Baseline: `ff97e0f4ed476cd33be095a8814f90936849805a` (PR #30)

## Goal and acceptance

Fix the lost reconnect/online/realtime notification without changing API, MLS, encrypted persistence or the Minimal Messenger interface. If another refresh arrives while one is active, perform a serialized follow-up, coalesce bursts, and let all callers await the drain. A failed transport sync must disable authoring while retaining decrypted history. Successful recovery must enable authoring and remove only the stale secure-sync warning.

Do not change the 50% Sudoku gesture, timeouts, retry count or crypto acceptance assertions. Do not deploy production. Deferred physical/live Step 70 remains deferred.

## Evidence and root cause

Post-merge CI #277, run `35639832585`, job `106466169839`, failed at the assertion that `Secure sync is blocked` appears after aborting transport requests and dispatching `online`. The mobile Sudoku browser scenario passed. Production operations/Compose/image steps following browser acceptance were skipped, not passed.

`EncryptedConversationView.refreshProjection` previously returned the existing promise whenever a refresh was active, without retaining a pending notification. The UI published its decrypted projection and enabled the composer before awaiting `markRead`. An online event arriving during that read receipt reused the old promise and never requested another transport sync. The adapter already coalesces transport calls, but this UI guard prevented the new call from reaching it.

The successful-sync path also left the previous blocked-sync warning visible. Recovery now clears that exact warning without erasing unrelated send/upload errors.

## Tasks and implementation

1. Reproduce the old single-flight guard in an isolated scheduler test: three of seven tests fail, including the read-receipt overlap.
2. Replace that guard with `createRefreshQueue` in `apps/web/features/messenger/refresh-queue.ts`. It runs one task at a time, retains the latest pending task, drains follow-ups, shares completion across callers and releases state on unexpected rejection.
3. Integrate the queue in the encrypted view and clear only the stale sync warning after successful recovery.
4. Strengthen the existing browser acceptance by holding a real read-receipt request, dispatching another online notification while it is held, aborting subsequent transport requests, and asserting blocked authoring, preserved history, recovered authoring, cleared warning and a successful post-recovery send.
5. Add the seven Node regressions to CI and retain browser failure traces/screenshots for three days. No gate is removed or made less strict.

The scheduler is per mounted view and adds no dependency. Recoverable transport errors remain handled by the view. An unexpected task rejection rejects the current drain; later explicit requests may retry.

## Local verification

The source snapshot was checked against the baseline blob. Pinned Node dependencies and the prebuilt OpenMLS WASM were restored from existing repository CI artifacts; npm installation and Rust compilation were not repeated locally.

- Extracted legacy guard: 3 failing / 4 passing scheduler tests (red reproduction).
- Corrected queue: 7/7 scheduler tests passed.
- Domain suite: 13/13 passed.
- UI contract tests: 7/7 passed; 132 CSS classes checked.
- Web ESLint: 0 errors, 18 pre-existing warnings.
- Web TypeScript: passed.
- Next production build: passed; generated config/type-file changes excluded from this correction.
- Bundle budget: passed; 10 chunks, 210,869 bytes total JS gzip, 71,470-byte largest chunk; WASM 2,709,987 bytes.
- Playwright test discovery: both browser scenarios load successfully.

The isolated red/green scheduler test is not a claim that the complete browser stack was run locally. The full API/PostgreSQL/Redis/OpenMLS/browser/production-image CI remains required for this exact correction. Record its result in the PR before merging; physical two-device/iOS/Android verification is a separate deferred gate.

## Review and stop criteria

Reviewed notification ordering, burst coalescing, non-overlapping execution, errors/retry, independent queues, failure-message recovery and preservation of the API/MLS boundary. Only the encrypted view, its scheduler/tests, CI evidence retention and progress documentation are in scope; unfinished UX3 scripts are not applied.

Stop without merging if any regression, typecheck, lint, build, bundle, browser or production image/Compose check fails. Do not substitute a rerun-only success for a reproduced cause. No production deployment is part of this step.

## Handoff

Next required evidence is the full CI result for the fix PR. Keep `main` unchanged while that gate is pending. If the held-read browser assertion fails, inspect the retained trace and request chronology rather than increasing sleeps/timeouts. A revert of the correction restores the old scheduler behavior, so it also reopens the lost-notification bug.

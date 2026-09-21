# Step 73 — Retain secure refresh notifications

Date: 2026-09-21
Branch: `fix/secure-refresh-notifications`
Baseline: `ff97e0f4ed476cd33be095a8814f90936849805a` (PR #30)

## Goal and acceptance

Fix the lost reconnect/online/realtime notification without changing API, MLS, encrypted persistence or the Minimal Messenger interface. If another refresh arrives while one is active, perform a serialized follow-up, coalesce bursts, and let all callers await the drain. A failed transport sync must disable authoring while retaining decrypted history. Successful recovery must enable authoring and remove only the stale secure-sync warning.

Keep the 50% Sudoku gesture, existing global/test timeouts, retry count and crypto acceptance assertions unchanged. Do not deploy production. Deferred physical/live Step 70 remains deferred.

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

## Initial local verification

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

## CI #278 follow-up — animation-frame assertion

CI #278, run `35649450887`, job `106497926666`, completed with failure on head `959d7044dcf0eb0e9362864f431dfcc3a45ce598`. Queue regressions, API/OpenMLS, dependency audits, domain/UI contracts, lint, typecheck, production web build and bundle budget passed. Browser acceptance failed; the subsequent production operations/Compose/image gates were skipped.

The retained artifact `10661593190` (`browser-failure-35649450887-1`) contains the mobile Sudoku failure: `ui-quality.spec.ts:140` expected top < -100 but read 0. Its trace records pointermove around 33936-33939 ms and the geometry read around 33944-33948 ms. The screen is already `is-dragging`, but its transform is still zero. `useSecretUnlock.queueOffset` intentionally applies movement in `requestAnimationFrame`; visibility of the inert underlay does not prove that this frame has run.

### Bounded correction

Only the UI test and this record are changed in the follow-up:
- replace the one-shot numeric assertion with `expect.poll` of the same top < -100 condition, bounded to 2 seconds, matching the existing return-motion assertion budget;
- assert the private layer is still inert before releasing the below-threshold drag;
- preserve the existing 49% return, 55% completion, gameplay, geometry, keyboard and privacy assertions;
- do not change production animation, the 50% threshold, global/test deadlines or test retries.

This observes the asynchronous result instead of adding a fixed sleep or relaxing the geometry condition. References: Playwright assertions documentation (`https://playwright.dev/docs/test-assertions#expectpoll`) and HTML animation-frame processing (`https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames`).

### Follow-up local checks

The restored pre-edit UI test and production hook match branch blobs `85e939fc1c4c579477b7496c1de44e6e6d957bc1` and `c6f2a82865e4e6aabce903881f5183c635858587` respectively. The patched UI test blob is `13f67f418d17993d299720976c951ad03f684a4d`.

An isolated characterization transpiles the actual production hook, supplies lightweight React/DOM stand-ins and controls its frame callback. With the trace coordinates (start Y 552.796875, target Y 281.92640625), the original immediate assertion fails with a queued frame and top 0; bounded polling observes [0, -270.87] after the frame is released. Unlock remains false at 49%. A negative control that never moves also fails polling. This is scheduling evidence, not a physical/browser acceptance pass.

Targeted ESLint for the changed UI test passed with no warnings/errors, web TypeScript passed on the restored source snapshot with that test patch, and Playwright discovery loaded the mobile scenario. No full browser run or production deployment is claimed locally. Full integrated CI for the follow-up head remains required.

## Review and stop criteria

Reviewed notification ordering, burst coalescing, non-overlapping execution, errors/retry, independent queues, failure-message recovery and preservation of the API/MLS boundary. The CI #278 follow-up is limited to frame-aware observation in the unchanged mobile gesture scenario. Unfinished UX3 scripts are not applied.

Stop without merging if any regression, typecheck, lint, build, bundle, browser or production image/Compose check fails. Do not substitute a rerun-only success for a reproduced cause. No production deployment is part of this step.

## Handoff

Next required evidence is the full CI result for the follow-up head of PR #31. Keep `main` unchanged while that gate is pending. If another browser assertion fails, inspect the retained trace and request/frame chronology rather than increasing sleeps/timeouts. A revert of the refresh correction restores the old scheduler behavior, so it also reopens the lost-notification bug.

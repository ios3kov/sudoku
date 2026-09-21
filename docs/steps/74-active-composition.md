# Step 74 — Preserve active encrypted composition

Date: 2026-09-21
Branch: `fix/preserve-active-composition`
Baseline: `ea063f410778280c302291b67337ec8510d14819` (PR #31)

## Goal and boundaries

Receiving a new message in the currently open encrypted chat must not erase unsent text, reply/edit mode or the expanded-history window. These are view-lifetime states, not transport-sync states. Drafts stay in memory only: leaving the view or hiding the messenger still discards them. A different conversation identity must receive a new component instance.

No API, MLS, outbox/persistence format, new dependency, visual redesign or production deployment change. Keep the Step 73 refresh queue, all crypto acceptance and the 50% Sudoku gesture unchanged. Physical/live Step 70 remains deliberately deferred. Do not apply the unfinished UX3 snapshot scripts.

## Reproduction and root cause

A deterministic local characterization transpiled the actual production `EncryptedConversationView`, with controlled React-hook and transport stand-ins. At baseline, advancing `conversation.latest_sequence` cleared the unsent body in ordinary draft, reply and edit cases: 3 failures. Replacing the conversation metadata without advancing its sequence preserved the text: the negative control passed.

The source matches this observation: `MessengerShell` updates latest_sequence for message.created; that changes `refreshProjection` callback identity; the dependent effect then resets body, reply/edit, message history and visibleCount. Autosizing and submit handlers do not cause this reset in the minimized signal.

The fix uses React's existing component identity model: the only caller keys `EncryptedConversationView` by selected conversation ID. State initializes on mount. Its refresh effect now performs synchronization only, so new metadata cannot erase composition. Changed conversation identity and ordinary Back/Hide unmounts still clear state. Old-view callbacks cannot populate the new keyed view's state.

## Implementation and acceptance

1. Reproduce ordinary draft/reply/edit loss and a same-sequence control before editing.
2. Remove sync-triggered state resets and explicitly key the view by conversation identity.
3. Extend existing MLS browser acceptance with incoming messages during draft, reply and edit, then verify clearing on Back/reopen and Hide.
4. Re-run local lint, types, domain/UI-contract, production build and bundle budget; require full integrated CI before merging.
5. Record final exact SHA/run evidence in the PR and keep production unchanged.

The additive browser helper is test-only. It observes the native WebSocket without replacing networking or application handlers, sends real encrypted messages through the UI/API, reads their assigned server sequence and delivers that notification into the real client's message handler. CI does not start the transactional-outbox worker, so deterministic notification injection is intentional. This checks the parent-prop update that an online event alone does not exercise; it is not a claim of live websocket delivery or physical-device verification. No test seam or observer is added to production code.

## Local verification

- Baseline characterization: draft/reply/edit fail; same-sequence control passes.
- Corrected characterization: all 4 cases pass. Hooks/transport are stand-ins, not a local browser pass.
- Domain tests: 13/13 passed.
- UI-contract tests: 7/7 passed; 132 CSS classes checked.
- Web TypeScript: passed.
- ESLint: 0 errors / 17 existing warnings (one reset-effect warning removed).
- Next production build: passed. Generated Next config/type edits are excluded from the commit.
- Bundle budget: passed; 10 JS chunks, 210,850 bytes total gzip, 71,470-byte largest chunk; WASM unchanged at 2,709,987 bytes.
- Playwright discovers both existing scenarios with the new helper loaded.

Pinned Node dependencies/prebuilt WASM were restored from earlier repository artifacts. Local npm/Rust rebuilds and local full-stack browser execution are not claimed. A first build command hit the tool execution deadline; rerunning with sufficient command time completed successfully without a source change.

## Review and stop criteria

Review focused on component identity, unchanged sync-blocked guards, memory-only drafts, preserved send/cancel behavior, additive rather than weakened acceptance, absence of a production observer and no API/MLS changes. No new runtime dependency or UI class is introduced.

Do not merge if integrated browser acceptance, crypto/offline recovery, typecheck, lint, build, performance budget or production image/Compose checks fail. Do not mark a pending run as verified. Final PR and post-merge results must identify their exact commits; they supersede this pre-CI checkpoint.

## Prior milestone closure

Step 73 is complete: PR #31 merged after CI #279, and post-merge CI #280 (`35652840406`) passed on `ea063f410778280c302291b67337ec8510d14819`. Its older pending handoff is superseded by the final PR #31 evidence. This Step 74 change is a separate UX correction, not part of that earlier pass.

## CI #281 navigation-test correction

CI #281 (`35654285320`, job `106513926121`) passed API, OpenMLS, audits, lint, types, build and budget. Browser acceptance reached the final Back/reopen check after draft/reply/edit preservation, then exhausted its 480-second test clock looking for an exact `Back` button. The shared header's existing accessible name is `Back to conversations`; the retained page snapshot in artifact `10664196669` confirms that control is present. The independent mobile Sudoku scenario passed; later infrastructure/image checks were skipped, not passed.

The correction changes only the test locator to the existing accessible name, asserts visibility and bounds the click to five seconds so a missing control fails at the relevant action. No production code, crypto assertion, privacy requirement, retry count or overall timeout changes.

Local verification of this follow-up: rendered the actual transpiled shared header with React DOM server and exercised it in the default managed Chromium using `setContent`; the old exact selector had zero matches, the corrected selector was visible and clicked successfully. This is a focused accessible-navigation check, not full-stack acceptance. Targeted helper ESLint and TypeScript against the restored pinned baseline plus helper passed. Full CI on the updated PR head remains required.

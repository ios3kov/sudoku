# Messenger UX 3.0 — final 1.0 product block

Date: 2026-09-21
Branch: `feat/messenger-ux3-final`
Baseline: PR #32, `9b4cf2be5dff938f03df9811f95e1f7b168afd4b`
Baseline tree: `d8a2f8d3998c153e72ebaa5709b598b08c16d413`

## Goal / completion boundary

Finish the agreed messenger 1.0 user experience, not expand its feature scope.
Keep the supplied Minimal Messenger design, 50% Sudoku reveal, authentication,
MLS wire payloads, transport ordering, encrypted persistence and API permissions.
No new package dependency, database migration or production deployment.

After this block, the remaining release work is integrated verification,
publication of the verified SHA and the separately deferred Step 70 acceptance.
A green repository pipeline does not certify physical devices or a live restore.

## Acceptance tickets

1. **History:** display actual server timestamps, local-day separators and
   consecutive same-sender groups up to five minutes. Reversed times, deleted
   entries and day changes break groups. Undated legacy records stay undated;
   never manufacture time from a sequence number or the current clock.
2. **Actions:** long press, desktop context menu and the existing actions button
   open an accessible dialog. Copy, reply, edit, reactions and deletion work;
   deletion needs confirmation. Native modal isolation plus explicit keyboard
   wrapping preserve focus. Close before Reply/Edit focuses the composer.
3. **Swipe:** a completed rightward 64 px gesture replies. Below-threshold,
   cancelled, vertical, media-control and multi-pointer interactions do not.
   A gesture that turns vertical cancels; release coordinates are authoritative.
   Dragging updates a compositor transform through requestAnimationFrame.
4. **Scrolling:** the initial rendered window is 120 messages. Reading older
   history freezes its tail and preserves the visible anchor through arrivals,
   history expansion and media/composer resizing. Jump-to-latest counts actual
   incoming messages, not sequence gaps, own sends or mutation events. Search
   jumps work repeatedly even inside the same rendered window.
5. **Status/read state:** distinguish Sending, Queued, server-accepted Sent and
   receipt-backed Read. Do not invent Delivered. Only visible latest history
   advances read state; receipt failures are not treated as success. Merge only
   monotonic receipt fields, including realtime receipts for encrypted chats.
6. **Drafts:** bounded RAM-only per-conversation drafts survive chat navigation.
   Editing has its own buffer. Hide/logout/account changes dispose the store;
   no new plaintext browser/server persistence. Incoming messages still preserve
   active composition (Step 74), and Step 73's refresh queue remains in use.

## Architecture / data decisions

- `packages/domain/src/messenger-ux.ts`: pure grouping, labels, gesture intent,
  incoming-count and bounded draft rules. No transport/DOM dependency.
- Shared `MessageTimeline`, `MessageMeta`, `MessageInteraction` and
  `MessageActionSheet` serve encrypted and existing legacy chat presentation.
- `ConversationDraftProvider` is keyed by authenticated account and mounted
  only inside the private surface. Conversation views are keyed by chat ID.
- `conversation-receipts.ts` merges only authenticated/acknowledged receipt
  watermarks into the current state; stale callbacks do not replace membership
  or newer metadata. Invalid/unknown-reader receipts leave state unchanged.
- Optional `created_at` transport metadata is copied into the existing encrypted
  journal and projected as optional `createdAt`. It is server display metadata,
  not authenticated sender time, permission evidence or ordering authority.
- The projection exposes its latest transport-message sequence, including edit
  events, to support read watermarks without inventing visible messages.
- The retained encrypted outbox provides pending-message display. No encryption,
  client-ID reuse, retry, KeyPackage, rekey or server authorization rule changes.

## Reproduction / review findings fixed

The legacy UX3 branch held verified patch data, not a complete implementation.
All 16 reconstructed targets were checked against their declared SHA-256 hashes,
then integrated on the Step 74 baseline. Missing components/styles/tests were
implemented here; old verification prose was not used as new execution evidence.
Conflicts explicitly retained the Step 73 queue and Step 74 sync-only lifecycle.

Red/green evidence from actual browser-rendered shared components found and fixed:
- a fixed tail slice/uncapped fixture failed the bounded-history expectation;
  a frozen window now keeps an older-history anchor without rendering arrivals;
- native Shift+Tab could leave the dialog focus cycle; explicit wrapping added;
- unmounting before native close lost focus restoration; close precedes unmount;
- a swipe turning vertical incorrectly replied; movement and release now cancel it;
- a second search jump sharing the same window end did not rerender; an explicit
  jump revision schedules the second position update.

Review also removed stale whole-conversation writes after read receipts and
unacknowledged search-read updates. Realtime receipts update encrypted-chat labels.
New UI modules do not enter the crypto wire protocol or add production test hooks.

## Automated coverage

- Domain: grouping/time/status/gesture/draft boundaries and optional encrypted
  timestamp projection, with undated legacy and edit-order controls.
- Node: existing seven serialized refresh regressions plus three monotonic
  receipt tests (peer/self, stale values, invalid input and unknown readers).
- Eight actual-component Chromium scenarios cover dates, DOM window/overflow,
  account/chat draft lifecycle, edit isolation, dialog keyboard/deletion, hold/
  swipe cancellation, repeated jumps, anchored expansion/resizing and read timing.
- The existing real MLS browser scenario keeps reload/offline/outage/recovery and
  incoming-composition assertions. It adds persisted dates, native action sheets,
  navigation drafts, receipt-backed Read and empty drafts after Hide/reopen.
- The API transport test requires display time to equal the accepted message time.

Read receipts now belong to visible-history presentation, so an unchanged sync
correctly does not send another receipt. The browser race test therefore holds a
successful *transport response*, sends another online notification while it is
held, then aborts following transport requests. It still requires a real failed
request, blocked authoring, retained history, recovery and a post-recovery send.
The queue's original held-read unit regression also remains. No assertion is
replaced with a sleep, retry-only pass or larger overall deadline.

The real-stack CI does not run the outbox worker. Test-only native WebSocket
observers deliver API-backed message/receipt metadata into the real client handler.
This is explicit deterministic event injection, not certification of worker fanout.
The component fixture uses the pinned Next webpack and TypeScript to bundle real
components only for tests; it exposes no application route or production hook.

## Local verification performed

- Domain tests: **24/24 passed**. Missing UX module / missing timestamp checks
  failed before implementation; the final suite includes legacy regressions.
- Refresh queue: **7/7 passed**. Receipt rules: **3/3 passed**.
- Shared-component Chromium: **8/8 passed**, including both newly reproduced
  gesture/search regressions; repeated full run also passed.
- UI contract tests: **7/7 passed**; imported styles cover **149 classes**.
- Web TypeScript: passed. ESLint: **0 errors / 17 existing warnings**; no warning
  is described as a clean audit. No lint rule was disabled for the test harness.
- Next production build: passed. Generated config/type edits excluded from source.
- Bundle budget: **214,872 bytes total JS gzip**, largest chunk **71,470**;
  OpenMLS WASM unchanged at **2,709,987 bytes**, service worker **2,546 bytes**.
- Python compileall: passed for API, migrations and API tests. Local Ruff/API/DB
  integration and dependency audit are not claimed; they run in full repository CI.
- Playwright discovers **10 scenarios**: 8 shared UX + 1 real MLS + 1 mobile Sudoku.
- Production static chunks contain neither fixture nor WebSocket test observers.

Pinned dependencies/prebuilt WASM were restored from existing repository CI
artifacts. No local npm download or Rust rebuild is claimed. Managed Chromium
executes the component fixture with setContent/script/style injection; no local
navigation policy was changed. This does not replace full service/browser CI or
physical iPhone gesture/keyboard/frame-pacing checks.

## Release gate / handoff

Full CI for the published UX3 head is **pending** at this documentation checkpoint.
Record the exact head, tree and run in its PR. Do not merge on pending/failed checks;
inspect retained browser evidence and fix the cause rather than relax acceptance.
After a green reviewed merge, post-merge CI remains a separate check. Temporary
source-materialization tooling must not appear in the final PR diff.

Production is unchanged. Do not update the last live-verified deployment or call
1.0 production-verified until the exact release's Step 70 evidence is recorded.

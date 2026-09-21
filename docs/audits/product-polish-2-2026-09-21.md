# Product polish 2.0 — messenger audit

Date: 2026-09-21

## Scope

Focused product/UX/performance/technical pass after the Minimal Messenger redesign was deployed.

Constraints:
- no API or MLS protocol redesign;
- no reduction of E2EE/session/privacy guarantees;
- keep the current Minimal Messenger visual direction;
- physical two-device/PWA/backup Step 70 verification remains deliberately deferred;
- full CI is still mandatory before merge.

## Product findings

### P1 — conversation loading could fail silently

The list loader previously cleared the loading state in `finally` but did not surface a failed `/v1/conversations` request. A network/server error could therefore look identical to an empty inbox.

Fix:
- explicit conversation-load error state;
- visible Retry action;
- loading skeletons instead of a dead text-only wait state.

### P1 — secure-runtime failure had no recovery path in the list

If OpenMLS/session initialization failed, the new-chat action became disabled but the list did not explain how to recover.

Fix:
- explicit secure-messaging status banner;
- one-tap reload recovery action.

### P1 — secondary panels could compete for the same layout

New chat, devices and admin invite were rendered inside the shell but were not all treated as exclusive overlays. Their state could overlap and some panels could expand the base list layout.

Fix:
- mutually exclusive overlay state;
- explicit dialog semantics without claiming focus trapping;
- absolute in-shell drawers/panels that do not reflow the conversation list.

### P1 — people search was too eager

The new-chat panel queried the user directory immediately, including empty/one-character queries.

Problems:
- unnecessary requests;
- avoidable directory exposure in an invite-only product;
- noisy empty/loading states;
- extra work during an already expensive secure-chat startup.

Fix:
- no directory request until 2 non-space characters;
- 220 ms debounce;
- explicit idle/searching/no-result states;
- stale results cleared on failure/short query;
- search input disables autocorrect/capitalization/spellcheck.

### P1 — composer did not actually auto-grow

The CSS allowed a taller textarea but both plaintext and encrypted composers stayed at their row height because no height synchronization existed.

Fix:
- shared `useAutosizeTextarea` hook;
- grows to 128 px, then scrolls internally;
- reset after send/edit cancellation;
- encrypted reply/edit now also focuses the composer, matching plaintext behavior.

### P2 — empty plaintext conversation had no intentional state

An empty plaintext/legacy conversation rendered as blank history.

Fix:
- explicit first-message empty state.

## UX/UI polish

Implemented:
- conversation skeleton loading;
- compact recoverable status banners;
- exclusive new-chat/device/invite drawers;
- selected-state semantics for Direct/Group and group member selection;
- group member discovery now follows the same 2-character minimum and avoids a no-op Save action when the group name is unchanged;
- dialog semantics for focused overlays;
- clear search hints and no-result feedback;
- autosizing composer;
- matching reply/edit focus behavior between plaintext and encrypted chats;
- shared initials helper instead of duplicated presentation logic;
- shared byte formatting reused by plaintext/encrypted attachment rendering.

The current 460 px mobile-first messenger frame, message bubble system, fixed iPhone scale and safe-area behavior remain unchanged.

## Performance / profiling review

### Improvements in this pass

- new-chat and group-member directory searches no longer fire for empty or one-character queries;
- no new runtime dependency was introduced;
- loading placeholders use existing DOM/CSS only;
- autosize work is limited to the active textarea and current text value;
- overlays no longer force base-list reflow;
- no work was added to the Sudoku pointer-move path;
- existing pre-unlock lightweight messenger preview remains intact.

### Existing known performance characteristics

From the existing automated gate before this pass:
- encrypted projection has already been profiled at 10,000 events in tens of milliseconds on CI hardware;
- production JS/WASM bundle budgets are enforced;
- encrypted attachment object URLs are released outside the near viewport;
- encrypted history uses a bounded visible-message window;
- the full OpenMLS/realtime runtime is mounted only after the Sudoku reveal completes.

### Still intentionally deferred

- encrypted journal IndexedDB write amplification for very large histories;
- physical-device OpenMLS startup/profile measurements;
- very large invite-only account/contact directories;
- physical keyboard/viewport profiling across multiple iOS versions.

These do not justify changing protocol persistence in this polish pass.

## Technical audit / refactor

Completed:
- `conversationInitials` moved into shared chat utilities;
- plaintext view now reuses shared `formatBytes`;
- autosize behavior extracted into one hook instead of duplicating DOM sizing logic;
- overlay state transitions centralized in MessengerShell;
- error/loading behavior made explicit instead of implicit empty-state fallthrough.

Deliberately not done:
- no broad rewrite of `MessengerShell`, `ConversationView` or `EncryptedConversationView`;
- no shared voice-recorder refactor in this pass because it touches permission/lifecycle/error paths and has higher regression risk than current duplication;
- no MLS startup-order changes;
- no IndexedDB persistence-format changes.

## Automated acceptance added

The browser MLS acceptance now also checks:
- secure-chat creation is exposed as a dialog;
- Direct mode has explicit selected semantics;
- fewer than 2 characters cause zero user-directory requests;
- a real directory request starts once the query is sufficiently specific;
- the composer grows for multiline text before sending.

Existing CI remains the release gate for:
- Python/API/migrations/audits;
- OpenMLS Rust/WASM;
- npm audit;
- UI class contract;
- ESLint/domain tests/typecheck;
- production Next build;
- bundle/performance budget;
- browser E2E;
- production scripts/MinIO/Compose;
- real production application image builds.

## Stop criteria

Do not merge if any of the following fails:
- Browser MLS recovery/offline/fail-closed acceptance;
- mobile Sudoku unlock acceptance;
- lint/typecheck/build;
- UI class contract;
- bundle/performance budget;
- production Compose/image build.

Physical Step 70 remains deferred by product decision and is not reclassified as complete.

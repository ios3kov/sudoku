# Messenger UX 3

Base: ff97e0f4ed476cd33be095a8814f90936849805a (PR #30).

## Goal and boundaries
Improve reading and replying in the existing Minimal Messenger, without replacing its API, MLS state, encrypted outbox, authorization or Sudoku unlock. Work on the feature branch only. Do not merge or deploy until automated checks pass. Physical Step 70, PWA and backup/restore drills remain deferred by the user.

## Acceptance
1. Preserve a separate text draft for each conversation while navigating between chats in the same open authenticated messenger. Never write drafts to localStorage, sessionStorage, plaintext IndexedDB, network or logs. Drafts are intentionally memory-only, and disappear when the authenticated runtime is closed, logged out or revoked. Editing an existing message must not overwrite the new-message draft.
2. Incoming transport updates must not reset the composer or the reader's scroll position. A button returns to the newest messages, with a local count of newly appended incoming messages while reading above the bottom. Editing, reactions and loading older history must not increment that count.
3. Touch hold opens the same action sheet as the existing More button. A deliberate rightward swipe replies; vertical scrolling, pointer cancellation, secondary pointers and interactive attachment controls must not trigger reply. Keep keyboard-accessible buttons as an alternative. Deleted messages cannot be replied to or edited.
4. The action sheet supports the existing reply/edit/reaction/delete operations plus explicit text copy. Ownership and secure-sync gates remain authoritative. It has a real modal focus boundary, Escape/close, focus restoration, a separate delete confirmation and immediate concealment on page background.
5. Date separators and local times must use actual message timestamps. The encrypted projection currently has no timestamp: use only matching message IDs from the existing authorized message-metadata API, with bounded best-effort requests. Missing/offline dates remain unknown (sequence fallback); never substitute the current date. Dates are server metadata, not a new authenticated MLS field.
6. Preserve 16px inputs, fixed product scale, safe areas, reduced-motion support and the current 50% Sudoku unlock.

## Implementation order
- Add and test pure draft/timeline/arrival/gesture policies.
- Add session-scoped draft ownership, shared gesture/sheet/scroll components.
- Integrate both conversation views without changing send/encryption semantics; remove the encrypted refresh dependency that currently resets editing/composition on latest_sequence updates.
- Add bounded timestamp lookup for encrypted display metadata and date separators.
- Extend browser acceptance, run type/lint/build/domain/E2E/bundle checks, review the resulting diff and update the audit/progress documents.

## Risks and stop rules
No fictional read/delivery timestamps. No decrypted content in persistent draft storage. No inferred authorization from the UI. No duplicate sends after a pointer gesture. No native dialog surviving the privacy cover. No artificial green checks by disabling assertions, broadening timeouts or bypassing MLS readiness. Desktop/browser profiling is not evidence of physical iPhone smoothness; record those limits explicitly.

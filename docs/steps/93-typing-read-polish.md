# Step 93 — typing and read-state polish

Date: 2026-09-24.

## Goal

Finish the remaining P1 conversation-presence polish without inventing a second messaging protocol.

The repository already has:

- authenticated WebSocket typing frames (`typing.started` / `typing.stopped`);
- membership-scoped Redis fan-out;
- read-watermark API and realtime `receipt.updated` events;
- monotonic receipt merging;
- `Sent` / `Read` labels.

This step reuses and hardens those primitives, and brings the same behavior to encrypted conversations.

## Reference patterns

Behavior is informed by mature clients such as Signal iOS and Element X:

- typing is ephemeral presence, not persisted message history;
- outgoing typing starts once, refreshes while the user remains active, and stops on inactivity/send/navigation;
- incoming typing has a local fail-safe expiry in case the stop event is lost;
- receiving a message from a typing user clears stale typing immediately;
- message delivery states must represent evidence actually available to the client.

Only patterns are reused. No GPL/AGPL implementation code is copied.

## Typing behavior

Create one shared web typing-presence controller used by both plaintext and MLS conversation views.

Outgoing:

- first non-empty authoring transition sends `typing.started`;
- do not emit one frame per keystroke;
- while continuously typing, refresh at a bounded cadence so remote expiry does not fire;
- 1.5 seconds of inactivity sends `typing.stopped`;
- empty composer, successful send, conversation switch, private-surface hide/pagehide, and document hidden stop typing immediately;
- editing an existing message does not advertise typing;
- voice-draft/recording mode does not advertise text typing.

Incoming:

- ignore self events and events for another conversation;
- each remote sender expires locally after 3.5 seconds if a stop event is lost;
- `typing.stopped` removes immediately;
- a new message from that sender removes stale typing immediately;
- direct chat: `<name> is typing…`;
- group: one/two names, then `N people are typing…`;
- reserve indicator height so the timeline/composer does not jump.

Security/privacy:

- typing frames contain conversation ID + user ID only, never message text;
- server continues to validate active conversation membership before fan-out;
- typing is intentionally not persisted;
- typing metadata is not MLS-encrypted. This is presence metadata, not message content, and must be documented as such.

## Read-state semantics

Do not add a synthetic `Delivered` state.

Current evidence supports:

- `Sending`: local request/pending state;
- `Sent`: server accepted the message;
- `Read`: a peer read watermark reached the message sequence;
- group: `Read by X of N`.

A future `Delivered` label requires a real recipient-device delivery acknowledgement and is out of scope.

Polish:

- continue monotonic receipt merging; stale/out-of-order receipts must never move backward;
- expose reader names as accessible/title detail for group read state;
- do not emit duplicate read API writes for the same/lower local watermark;
- realtime receipt updates must update encrypted and plaintext message status without reload.

## Verification

Required before merge:

- typing start is coalesced rather than emitted on every keystroke;
- continuous authoring refreshes before remote expiry;
- inactivity/empty/send/unmount/hidden surface sends stop;
- lost stop event expires locally;
- incoming message clears stale typing;
- encrypted conversation sends/renders typing through the existing realtime client;
- group typing label names one/two users and summarizes larger groups;
- read watermark writes are monotonic/deduplicated;
- stale realtime receipts cannot regress state;
- direct/group Sent/Read semantics remain truthful;
- web lint/typecheck/build/performance and browser acceptance;
- exact-head ci, device-access, beat-runtime and api-shutdown are green; ios-native must also be green when that workflow is triggered by the changed paths, otherwise the latest merged iOS baseline remains the iOS evidence.

## Release boundary

Repository work only.

No production deployment, migration, TestFlight upload or App Store submission is authorized by this step.

## Merge verification — 2026-09-24

PR #73 merged as `ceccb776a645fec5ca671491f9eeb9d0a3648a07` after final diff/code review and successful checks on exact head `ad9d711c117951b814396eb84d202702b36390e9`:

- ci: [35990476692](https://github.com/ios3kov/sudoku/actions/runs/35990476692)
- device-access: [35990476663](https://github.com/ios3kov/sudoku/actions/runs/35990476663)
- ios-native: [35990476686](https://github.com/ios3kov/sudoku/actions/runs/35990476686)
- beat-runtime: [35990476613](https://github.com/ios3kov/sudoku/actions/runs/35990476613)
- api-shutdown: [35990476606](https://github.com/ios3kov/sudoku/actions/runs/35990476606)

CI fixes register fixture realtime callbacks in an effect, give browser fixtures a trustworthy origin and fresh projection snapshots, and wait for logout completion before navigation. Final review found no blocking issues. Only Typing/read-state polish is complete in issue #63; accessibility and physical-iPhone acceptance remain open. No production deployment or release was performed.

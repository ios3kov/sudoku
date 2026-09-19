# Step 08 — Messenger UX completion

## Goal

Turn the transport-level chat into a usable mobile messenger without weakening the hidden Sudoku shell.

## Implemented

- Direct and group chat creation.
- Replies with quoted context.
- Edit/delete for the sender's own messages.
- Heart reactions with realtime updates.
- Per-member read watermarks and sender-side read labels.
- Voice-note capture with `MediaRecorder`, five-minute cap, and the same verified asset pipeline as files/images.
- Connection state shown as `connected` / `offline` rather than pretending it is another user's presence.
- Fast `Hide` control inside an open conversation.
- Realtime event de-duplication on React re-render.
- Interactive attachments/audio are no longer nested inside action buttons.
- Composer layout adjusted for text, attachment, voice and send controls.

## Reliability

- Offline queue remains text-only; media intentionally requires a live connection.
- Voice and attachment sends use a server-issued asset ID only after server-side object verification.
- Reconnect performs PostgreSQL sequence catch-up rather than trusting Redis history.

## Verification

- TypeScript/TSX syntax transpile passes for the web/domain source set.
- Domain build and tests pass: 7/7.
- Python bytecode compilation passes after the corresponding backend schema changes.
- Full browser build/E2E remains pending until project dependencies and service containers are available.

## Next step

Production hardening: controlled invite administration, WebSocket origin enforcement, action rate limits, orphan-storage cleanup, push endpoint validation, and broader runtime checks.

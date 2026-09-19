# Step 06 — Mobile Chat Client + Offline Outbox

## Goal

Make the authenticated private surface usable as a real mobile chat rather than an API-only backend.

## Implemented

- Conversation list with unread counts.
- Invite-member directory search and direct-chat creation.
- Mobile conversation view and message composer.
- Recent-history loading plus `after sequence` catch-up.
- Optimistic pending messages.
- IndexedDB offline outbox.
- Pending message bodies are encrypted with a non-exportable AES-GCM WebCrypto key stored through IndexedDB; plaintext is not intentionally persisted in localStorage.
- Automatic outbox retry on reconnect/`online` events.
- WebSocket client with heartbeat and exponential reconnect.
- Realtime `message.*` merge and typing indicators.
- Read watermark updates.
- Outbox is cleared on logout to prevent cross-account replay from a shared browser profile.
- Push notification clicks force any already-open private surface back to Sudoku before focusing the app.

## Reliability behavior

- Server `client_id` idempotency makes outbox retries safe.
- Missing Redis/WebSocket events are recovered by REST catch-up using the last sequence seen in the conversation.
- 4xx message failures are not retried forever; transient/network/5xx failures remain queued.

## Security notes

IndexedDB encryption protects casual at-rest inspection of the outbox but is not a defense against XSS or a compromised browser origin, because application JavaScript can use the stored CryptoKey. CSP and dependency hygiene remain mandatory.

## Verification

- Domain tests remain green.
- API bytecode compilation remains green.
- Browser build/typecheck is pending dependency installation because the execution environment cannot reach npm.

## Next step

Implement S3-compatible immutable asset uploads, image/file messages, push subscription storage/delivery, then run end-to-end tests in a service-capable environment.

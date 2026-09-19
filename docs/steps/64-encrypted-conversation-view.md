# Step 64 — Encrypted ConversationView

## Goal
Replace the encrypted-chat placeholder with a real projected history and composer that use only the OpenMLS adapter.

## Hard boundary
For `encryption_required=true` conversations this view does not call:
- `messengerApi.messages()`;
- plaintext `sendMessage()`;
- plaintext edit/delete/reaction endpoints.

The legacy ConversationView remains isolated to old non-E2EE development conversations.

## History
The view synchronizes the unified durable MLS transport and renders only `adapter.projectConversation()`, which is derived from the locally encrypted decrypted-event journal.

Incoming realtime events are wake-ups only; message content is never trusted from the realtime payload.

## Outbound text
New messages go through `sendMessageDurably()`:
- MLS encryption happens before network;
- ciphertext + plaintext projection event are persisted in the encrypted local outbox;
- the same ciphertext/client-id is retried after network failure;
- successful server acceptance journals the local event.

If delivery fails after durable preparation, the composer reports a securely queued update rather than re-encrypting it.

## Encrypted mutations
Reply metadata is inside the MLS message event.
Edits, reactions and deletes use encrypted application events through:
- `sendEditDurably()`;
- `sendReactionDurably()`;
- `sendDeleteDurably()`.

The deterministic projection enforces author rules for edit/delete and rejects mutations targeting missing/deleted messages.

## Fail-closed behavior
If the MLS adapter is not ready, MessengerShell does not render the encrypted composer/history. It shows only an unavailable/initializing state; there is no plaintext fallback.

## Deliberate remaining gap
Encrypted attachment/voice UI is not yet activated. Existing encrypted attachment events are shown only as an opaque attachment count rather than fetching ciphertext through a legacy renderer.

## Next
Step 65: wire encrypted file/image/voice upload and authenticated client-side download/decryption into this view, then add safety-number verification UI.

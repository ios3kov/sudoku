# Step 57 — Crash-consistent decrypted event journal

## Goal
Make MLS receive-ratchet advancement and local decrypted-history persistence one durable browser operation.

## Problem
Decrypting an MLS PrivateMessage advances receiver ratchet state. If the provider state were persisted first and the decrypted projection cached in a separate later write, a crash between those writes could permanently lose the plaintext event: the replayed ciphertext may no longer be decryptable from the advanced state.

## Design
The encrypted local MLS state now also contains an event journal keyed by conversation id.

`decryptAndJournal()`:
1. checks whether the server message id is already journaled;
2. snapshots OpenMLS provider + local state;
3. decrypts and advances the OpenMLS receive ratchet;
4. validates the decrypted application event;
5. appends the event id/sender/sequence/decrypted event to the journal;
6. writes provider state and journal together through one BrowserProtocolStateStore put;
7. restores the snapshot if any step fails.

The state store already wraps the entire value with non-exportable AES-GCM before IndexedDB persistence, so the local journal plaintext is encrypted at rest.

## Replay behavior
If the same durable server message id is seen again after reconnect, the adapter returns the journaled event without asking OpenMLS to decrypt the ciphertext again.

## Projection
`projectConversation()` feeds the durable journal into Step 56's pure deterministic projection reducer.

## Compatibility
Existing local state without `eventJournal` migrates in memory to an empty journal. The provider state and identity pins are preserved.

## Security status
This creates a crash-safe receive history primitive but does not yet switch ConversationView to E2EE. Outgoing own-message journaling and encrypted outbox semantics are the next requirement before UI activation.

## Next
Step 58: crash-safe encrypted outbound journal/outbox, including reconciliation of client id to durable server message id/sequence.

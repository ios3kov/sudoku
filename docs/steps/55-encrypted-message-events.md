# Step 55 — Encrypted edit, reaction and delete events

## Goal
Eliminate remaining server-readable content mutations in E2EE conversations.

## Server fail-closed boundary
Legacy edit, reaction and delete endpoints remain available for plaintext conversations but return 409 for E2EE conversations. This prevents edited bodies, reaction emoji and delete intent from being written into server-readable message/reaction state.

## MLS application events
The browser adapter supports encrypted event kinds:
- message;
- edit;
- reaction;
- delete.

The regular message event includes encrypted attachment metadata introduced in Step 54. Edit/reaction/delete payloads are serialized only inside the MLS application plaintext before encryption.

## Receive path
The decrypted application payload is treated as a discriminated event and schema-validated before it is returned. Invalid events fail closed and the existing crash-safe mutation wrapper restores the previous OpenMLS provider snapshot if persistence cannot complete.

## Integration test
The API test creates an E2EE ciphertext message and verifies legacy edit/reaction/delete endpoints all return 409. The database remains ciphertext-only: body_text is NULL, the envelope is unchanged, deleted_at stays NULL and no plaintext reaction row is created.

## Next
Step 56: deterministic local conversation projection for encrypted message/edit/reaction/delete events with replay/idempotency tests before the UI is switched to E2EE.

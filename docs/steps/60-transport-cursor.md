# Step 60 — Crash-safe unified transport cursor

## Goal
Consume Step 59's unified application/control transport feed in strict order and persist progress atomically with OpenMLS state.

## Encrypted local state
The local MLS state adds `transportCursors[conversationId]`.

Older local state migrates to cursor 0.

## Sequential sync
`syncTransport(conversationId)`:
1. flushes any prepared local membership transition;
2. flushes durable outbound application sends;
3. retries pending control ACKs;
4. fetches unified transport items after the durable cursor;
5. processes each returned item in transport-sequence order.

Sequence gaps are allowed because some control events are intentionally assigned to other devices, but every returned item must be strictly newer than the local cursor.

## Application item
For a remote application message:
- snapshot provider/local state;
- decrypt through OpenMLS;
- validate the encrypted application-event schema;
- append the decrypted event journal entry;
- advance the transport cursor;
- persist provider + journal + cursor in one encrypted IndexedDB write.

Failure restores the snapshot and cursor.

If the message id already exists in the local journal (for example, the sender's own Step 58 delivery), the client only advances the cursor and persists. It never decrypts the same MLS ciphertext twice.

An own message missing its local journal fails closed because MLS cannot safely reconstruct that sender plaintext by decrypting its own PrivateMessage.

## Control item
For Commit/Welcome:
- resolve and verify the pinned sender identity;
- process OpenMLS transition;
- record a pending server ACK;
- advance the transport cursor;
- persist provider + pin + pending ACK + cursor atomically;
- only then attempt ACK.

If network ACK fails, the cursor stays advanced and the durable pending-ACK queue retries later, so the control message is not applied twice.

## Server boundary
The unified transport endpoint now rejects non-E2EE conversations. Removed recipients may still retrieve explicitly assigned removal controls but cannot retrieve later application messages.

## Next
Step 61: browser adapter lifecycle (current session UUID as MLS device id), automatic KeyPackage replenishment, and unified transport sync on realtime/reconnect before E2EE chat creation is enabled.

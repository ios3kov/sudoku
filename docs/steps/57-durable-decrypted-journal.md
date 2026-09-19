# Step 57 — Crash-consistent decrypted event journal

## Goal
Make MLS receive-ratchet advancement and local decrypted-history persistence one durable browser operation.

## Design
The encrypted local MLS state contains a per-conversation decrypted event journal. `decryptAndJournal()` snapshots runtime state, decrypts, validates the application event, appends its durable server id/sender/sequence, and persists provider state + journal in one encrypted IndexedDB write. A persistence failure restores the provider snapshot.

Duplicate durable server message ids are served from the journal without replaying the MLS ciphertext.

`projectConversation()` rebuilds visible state through Step 56's deterministic reducer.

## CI finding
The domain journal deliberately stores attachment metadata as generic records, while the web adapter exposes the narrower `EncryptedAttachmentMetadata` type. TypeScript rejected a direct cast.

## Fix
Journal replay now re-validates every stored attachment with the same runtime `isEncryptedAttachmentMetadata` guard used for freshly decrypted payloads before returning the web-specific type. No unchecked cast remains.

## Security property
A corrupted or incompatible local journal fails closed rather than treating arbitrary stored records as attachment keys/nonces.

## Next
Step 58 provides the symmetric crash-safe outbound MLS outbox; Step 59 adds unified application/control transport ordering.

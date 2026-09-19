# Step 35 — E2EE server boundary

## Goal
Make the API capable of ciphertext-only conversations before client cryptography is introduced.

## Implemented
- Migration `0006_e2ee_boundary`.
- `conversations.encryption_required`.
- Versioned JSON ciphertext envelope on messages.
- Public per-device identity/signed-prekey/one-time-prekey registry; private keys are never accepted.
- E2EE message creation rejects plaintext `body` and requires an envelope.
- Legacy conversations reject an E2EE envelope to avoid ambiguous mixed state.
- Message serialization returns envelope while plaintext body remains null.
- Server-side content search returns 409 for E2EE conversations.
- Device key bundles can be revoked.

## Integration invariants
The test creates an E2EE conversation and verifies:
1. plaintext send returns 422;
2. envelope send succeeds;
3. API response contains no plaintext body;
4. PostgreSQL `body_text` is null;
5. PostgreSQL stores only the opaque envelope;
6. server search is unavailable.

## Compatibility
Existing development conversations remain legacy/plaintext during migration. Production remains blocked until creation is forced E2EE-only and the client protocol adapter/encrypted attachments are complete.

## Next
Run full CI, fix schema/message integration defects, then implement one-time-prekey atomic consumption and browser protocol adapter evaluation.

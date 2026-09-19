# Step 42 — Persist and enforce conversation encryption mode

## Finding
The create-conversation request accepted `encryption_required`, but the field was not copied into the new `Conversation` row. The API response therefore created a legacy/plaintext conversation even when the caller requested E2EE, allowing plaintext message creation.

## Fix
- Persist `payload.encryption_required` when creating a conversation.
- For an already-existing direct conversation, reject an encryption-mode mismatch with 409 instead of silently returning a conversation with different security semantics.
- Integration test now asserts the newly created E2EE conversation immediately reports `encryption_required: true` before testing plaintext rejection.

## Security impact
This closes a fail-open path where an E2EE creation request could degrade silently to plaintext transport.

## Verification
Required CI sequence:
- compileall;
- migrations 0001–0008;
- legacy integration;
- E2EE plaintext rejection + ciphertext-only persistence;
- MLS KeyPackage single-use/replay;
- web typecheck/build;
- production compose validation.

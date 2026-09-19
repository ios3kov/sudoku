# Step 35 — E2EE server boundary

## Goal
Make the API capable of ciphertext-only conversations before client cryptography is introduced.

## Implemented
- Migration `0006_e2ee_boundary`.
- `conversations.encryption_required`.
- Versioned JSON ciphertext envelope on messages.
- Public per-device identity/signed-prekey/one-time-prekey registry; private keys are never accepted.
- E2EE message creation rejects plaintext `body` and requires an envelope.
- Legacy conversations reject an E2EE envelope.
- Server-side content search returns 409 for E2EE conversations.
- Device key bundles can be revoked.

## First CI finding
The initial commit contained a generated-source defect: an automated string patch inserted a literal `\\n` into `models.py`, so Python failed to parse before Alembic could run. The E2EE migration itself had not executed.

## Fix
- Replaced the literal escape with a real newline.
- CI now runs `python -m compileall -q app alembic` before migrations so source-generation/syntax defects fail immediately.

## Integration invariants
Plaintext send must return 422; ciphertext envelope succeeds; API/DB plaintext body remains null; server search is unavailable.

## Next
Repeat full CI through migration/integration before proceeding to atomic one-time-prekey consumption.

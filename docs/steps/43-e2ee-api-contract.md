# Step 43 — Complete E2EE API contract

## Findings
CI exposed that the E2EE database/model changes were only partially reflected in the FastAPI response/write contract.

Specifically:
- ConversationResponse omitted `encryption_required`, so FastAPI filtered it out.
- MessageResponse omitted the ciphertext envelope.
- E2EE message creation validated the envelope, but then still populated legacy plaintext/encryption_version fields.
- Server-side content search had regressed to plaintext search without an E2EE guard.

## Fix
- ConversationResponse now includes `encryption_required`.
- MessageResponse now includes `envelope`.
- E2EE text messages may have a null plaintext body when an envelope is present.
- E2EE rows store `body_text = NULL`, persist the opaque envelope and set `encryption_version = 1`.
- Legacy conversations continue to reject ciphertext envelopes.
- Server-side content search returns 409 for E2EE conversations.

## Security impact
This aligns request validation, persistence and response serialization so an E2EE conversation cannot pass policy validation and then silently write legacy plaintext fields.

## Verification
Required CI gates:
- compileall;
- migrations 0001–0008;
- legacy MVP integration;
- E2EE plaintext rejection/ciphertext persistence/search denial;
- MLS KeyPackage single-use/replay;
- web typecheck/build;
- production compose validation.

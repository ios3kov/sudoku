# Step 68 — Device rekey reconciliation and safety-number UX

## Goal
Keep existing MLS groups aligned with authenticated device lifecycle changes and expose human-verifiable peer device identities.

## Device lifecycle reconciliation
A new authenticated MLS device schedules a device-add membership change for every ready encrypted conversation the user belongs to.

Session/device revocation schedules device-remove changes. Changes are serialized per conversation and promoted in order so only one MLS membership transition is pending at a time.

Before authoring new MLS application traffic, the browser reconciles pending device changes. This prevents sending from stale epochs while an active device still needs to be added or a revoked device still needs removal.

Reload/reconnect recovery uses the same durable membership-change ids and control transport. Revoked control senders can still be authenticated from pinned historical identity data when processing already-assigned durable control events.

## Production policy
Production Compose sets `REQUIRE_E2EE_NEW_CONVERSATIONS=true`. The API rejects new plaintext conversation creation in that mode, so the browser cannot silently downgrade around the secure creation flow.

## Safety numbers
The encrypted chat exposes Verify UI.

For every active peer device that is actually present in the local MLS group:
- the browser verifies the current discovery identity against its encrypted TOFU pin;
- a symmetric SHA-256 safety number is derived from both device identities;
- the user can copy/compare the value through an independent channel;
- Mark verified stores only a local encrypted verification timestamp.

An identity mismatch fails closed instead of carrying forward the prior verified state.

## Acceptance coverage
API/integration coverage includes device add/revoke rekey lifecycle. Browser acceptance covers reload, offline encrypted outbox retry and fail-closed authoring when secure transport is unavailable.

## Next
Step 69: final security/code review, full CI, production Compose verification, then physical mobile/live deployment smoke tests.

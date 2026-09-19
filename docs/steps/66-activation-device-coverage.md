# Step 66 — Server activation device coverage

## Goal
Make the server independently enforce that pending E2EE conversations cannot activate while any active participant MLS device is missing durable Welcome delivery.

## Enforcement
`POST /v1/e2ee/conversations/{id}/activate` now:
1. verifies the creator's current authenticated session is an active registered MLS device;
2. derives all active MLS devices belonging to current conversation members, joined to non-revoked/non-expired sessions;
3. excludes only the creator's current device, which is the initial MLS group leaf;
4. loads all persisted `welcome` recipient pairs for the conversation;
5. returns 409 if any expected active device is uncovered;
6. flips `e2ee_ready` only after coverage is complete.

The server still cannot cryptographically validate opaque MLS Welcome bytes; cryptographic validation remains client-side. This gate prevents a client from bypassing the durable device-delivery choreography.

## Regression coverage
The transport integration test now registers both participant devices, proves premature activation returns 409, sends a Welcome to the recipient device, then proves activation succeeds. Unified transport sequence expectations include that bootstrap Welcome.

## Next
Step 67: route group add/remove membership through MLS transitions before server membership mutation.

# Step 63 — Offline removal catch-up

## Finding
The first MessengerShell lifecycle integration synchronized only conversations returned by the current server membership list.

That is insufficient for MLS removal. A device can be assigned a Remove Commit, lose its server-side conversation membership, go offline, and restart before processing that commit. After restart the conversation is no longer returned by `/conversations`, even though the durable MLS transport feed still contains a control event explicitly assigned to that device.

## Fix
The OpenMLS adapter now exposes `trackedConversationIds()`, derived from durable local transport cursors, decrypted event journals, pending application sends and a pending membership transition.

On initialization and every realtime reconnect, MessengerShell synchronizes the union of:
- currently visible encrypted server conversations;
- locally tracked MLS conversations.

A realtime `mls.control.created` event always wakes MLS transport sync for its conversation, even if current server membership has already disappeared.

Current-device session revocation also deletes the encrypted local OpenMLS state before leaving the private surface.

## KeyPackage maintenance
Reconnect and MLS control wake-ups also replenish the current device KeyPackage pool to the configured target.

## Security property
A removed device can still receive and process the Remove Commit that makes its local MLS group inactive. It cannot silently retain a stale pre-removal epoch merely because the server membership row disappeared before a restart.

## Verification
Required gates:
- OpenMLS native tests;
- generated browser WASM;
- TypeScript typecheck;
- Next production build;
- API integration/migrations;
- production Compose validation.

## Next
Step 64: replace legacy encrypted-chat placeholder/ConversationView path with the projected encrypted journal and encrypted composer, keeping legacy plaintext conversations isolated from production E2EE-only mode.

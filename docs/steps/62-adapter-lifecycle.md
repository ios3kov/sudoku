# Step 62 — Browser MLS adapter lifecycle and KeyPackage pool

## Goal
Initialize exactly one browser OpenMLS adapter for the current authenticated session/device, maintain a public KeyPackage pool and keep encrypted conversations synchronized without yet enabling the E2EE composer UI.

## Device lifecycle
MessengerShell reads the current auth session and uses its stable UUID from Step 61 as the OpenMLS device id.

It initializes one `OpenMlsProtocolAdapter` for the signed-in user/session and registers the device identity through the existing adapter initialization path.

## Crash-safe KeyPackage publication
Local state now includes `pendingKeyPackagesB64`.

Creating public KeyPackages:
1. creates the OpenMLS private/public package material;
2. stores the public package bytes in the encrypted local pending queue together with provider state;
3. persists before network publication;
4. publishes the exact bytes;
5. clears the local pending queue only after success.

Initialization retries a pending publication before any replenishment.

The server publish endpoint is now idempotent for an identical KeyPackage already owned by the same user/device. If the row was already consumed, retry remains success but does not resurrect it. A collision owned by another device remains 409.

`ensureKeyPackagePool(10)` replenishes the current device to ten server-visible unclaimed packages.

## Realtime/reconnect
When the current WebSocket opens, the shell calls `syncTransport()` for known encrypted conversations.

Realtime `message.created` or `mls.control.created` wakeups trigger the same unified transport sync for the affected encrypted conversation.

The adapter serializes concurrent syncs internally.

## Fail-closed UI
ConversationView is still the legacy plaintext surface. Therefore any `encryption_required=true` conversation is temporarily rendered as a locked secure-chat placeholder even when the adapter is ready. It cannot accidentally call legacy plaintext send/edit/reaction/delete code.

## Logout
After successful server logout, the current session's encrypted local MLS state is deleted from IndexedDB. The server-side session/MLS device is already revoked by Step 61.

## Next
Step 63: E2EE conversation bootstrap choreography: create conversations with encryption_required=true, create the MLS group, claim KeyPackages for every active recipient device, deliver atomic Commit/Welcome transitions, and only expose the conversation after setup succeeds.

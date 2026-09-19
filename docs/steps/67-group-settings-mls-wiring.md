# Step 67 — GroupSettings MLS transition wiring

## Goal
Connect encrypted group controls to the server's two-phase membership-change choreography while preserving transition identity across crashes and retries.

## Durable transition identity
PendingOutboundTransition now stores membershipChangeId beside the generated Commit/Welcome bytes and stable event client ids.

Every retry sends the same membership_change_id. Initial conversation bootstrap continues to use a null transition id.

## Add
Encrypted GroupSettings:
1. prepares the add transition;
2. reconciles active devices of existing members;
3. discovers every active device for the new user;
4. validates KeyPackage identity and availability;
5. adds each missing device with tagged Commit/Welcome batches;
6. finalizes the server transition;
7. reloads the conversation.

## Remove
Encrypted GroupSettings:
1. prepares the remove transition;
2. reconciles current active devices;
3. removes target MLS leaves known from active discovery/local identity pins;
4. durably sends tagged Remove commits;
5. finalizes server membership removal.

The current device is ordered last when removing the current user so surviving device leaves are removed first.

## Empty remote recipient set
Remove transitions no longer require a remote recipient in the browser adapter. The delivery service can persist an opaque tagged commit even when no active remote recipient remains.

## UI boundary
EncryptedConversationView now exposes GroupSettings and passes the active OpenMLS adapter. Legacy plaintext groups keep their existing server-only group controls.

## Next
Step 68: reconcile revoked/new devices outside explicit group membership changes, add safety-number verification UI, then run browser reload/offline/retry acceptance.

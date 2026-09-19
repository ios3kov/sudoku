# Step 64 — New-chat MLS device bootstrap

## Goal
Make new Direct/Group creation E2EE-first and activate the server conversation only after all active participant devices are MLS members.

## Device-level membership
MLS membership is per device.

For every server conversation member:
- discover active registered MLS devices;
- exclude only the creator's current device, which owns the initial group;
- require each other user to have at least one secure device;
- require each missing active device to have a KeyPackage.

A device is never silently omitted because its package pool is empty.

## Bootstrap
1. create pending server conversation with `encryption_required=true`;
2. create and persist the local MLS group;
3. discover all participant devices;
4. identify already-present remote leaves for crash recovery;
5. claim KeyPackages only for missing leaves;
6. validate claimed user/device/identity against discovery and local pins;
7. add each missing device;
8. deliver each Commit to all existing remote leaves and Welcome to the new leaf through the durable atomic control transport;
9. activate only after all transitions complete.

## Crash recovery
Local state explicitly stores `trackedConversations` together with provider state.

Group creation is locally idempotent by that tracked id. Successful Welcome processing also tracks the group.

If NewChat fails after the server pending conversation exists, the creator is moved to the pending conversation rather than creating a replacement. After reload, Step 63 exposes that pending conversation only to its creator and MessengerShell provides `Resume secure setup`.

Bootstrap re-discovers current devices and checks which leaves are already in the local MLS group before claiming more KeyPackages.

## UI
NewChat now explicitly creates encrypted Direct/Group conversations and is disabled until the OpenMLS adapter is ready.

A ready encrypted conversation uses the already-existing EncryptedConversationView. A pending creator conversation shows only secure-setup recovery controls.

## Next
Step 65: complete encrypted attachment UX/download rendering, local search and safety-number verification UI; then group membership changes must be routed through MLS before server membership mutation.

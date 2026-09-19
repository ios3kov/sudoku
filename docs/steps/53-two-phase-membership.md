# Step 53 — Two-phase MLS membership transitions

## Goal
Prevent the creator from advancing to a new MLS epoch before the corresponding Commit/Welcome is durably accepted by the delivery service.

## OpenMLS behavior
OpenMLS `stage_commit()` already persists `PendingCommit` in the provider storage. The epoch changes only when `merge_pending_commit()` succeeds.

The binding now preserves that model instead of merging immediately.

## Binding changes
- `addMember(...)` prepares Add Commit + Welcome and leaves the local group in PendingCommit.
- `removeMember(...)` prepares Remove Commit and leaves PendingCommit.
- `mergePendingCommit(groupId)` is a separate explicit operation.

Application-message creation is blocked by OpenMLS while a membership Commit is pending.

## Crash/reload invariant
A new Rust test:
1. creates Alice/Bob identities;
2. prepares Alice's Add commit;
3. verifies application sends are blocked while pending;
4. exports provider state before merge;
5. reconstructs Alice from that state;
6. Bob joins from the prepared Welcome;
7. restored Alice merges the pending Commit;
8. messaging succeeds afterward.

This proves PendingCommit state survives reload and can safely bridge a durable-network handoff.

## Delivery requirement
The browser must:
1. prepare the transition;
2. persist provider state + outbound Commit/Welcome bytes;
3. durably submit the whole transition to the server;
4. only after successful server acceptance call `mergePendingCommit`;
5. persist merged provider state.

A crash at any point before step 4 leaves a retriable pending transition rather than a split epoch.

## Next
Add an atomic server control-event batch endpoint and wire the browser adapter to persist/retry outbound membership transitions before merging.

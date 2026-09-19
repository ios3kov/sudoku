# Step 54 — Fail-closed local MLS persistence rollback

## Goal
Keep in-memory OpenMLS state and encrypted IndexedDB state identical when local persistence fails.

## Risk found during Step 53 review
OpenMLS mutations advance ratchets and group state in memory before the browser's IndexedDB write completes. If an IndexedDB write fails and the app continues using the mutated in-memory provider, a reload restores older crypto state. That can cause generation/state divergence and unsafe retry behavior.

## Runtime snapshots
Before every ordinary OpenMLS mutation the adapter now snapshots:
- opaque provider state bytes;
- the encrypted-state metadata model held in memory.

If the mutation or its durable state write fails, the provider and metadata are reconstructed from that snapshot before the error is returned.

This covers:
- KeyPackage generation;
- group creation;
- application encryption;
- application decryption.

## Inbound control events
For Commit/Welcome processing:
1. snapshot current state;
2. apply the OpenMLS message;
3. record pending ACK;
4. persist provider + ACK marker;
5. only then ACK the server.

A failure before step 4 restores the snapshot. A failure after step 4 keeps the new durable state and retry marker, so the MLS message is not processed twice.

## Outbound membership transitions
Prepared PendingCommit state is made durable before network delivery.

After the atomic server batch is accepted:
1. snapshot the durable PendingCommit state;
2. merge pending commit;
3. persist merged provider while retaining the outbound retry marker;
4. clear the marker and persist again.

If merged-state persistence fails, runtime rolls back to the durable PendingCommit snapshot. If only marker clearing fails, runtime restores the marker; retrying the accepted batch and merging again is idempotent.

## ACK cleanup
If the server ACK succeeds but removing the local pending-ACK marker cannot be persisted, the marker is restored in memory. A later duplicate ACK is safe and restores convergence.

## Serialization
Normal crypto operations first flush any pending outbound membership transition. If the durable delivery cannot complete, the application operation fails closed rather than emitting traffic from a state that should have transitioned.

## Production gate
Identity verification, encrypted attachment bytes and end-to-end browser/device smoke tests remain required before UI activation.

## Next
Step 55: validated KeyPackage identity extraction + local peer identity pinning/fingerprint/QR verification.

# Step 58 — Crash-safe encrypted application outbox

## Goal
Make outbound MLS ratchet advancement, ciphertext retention, network retry and local plaintext projection crash-safe.

## Problem
Creating an MLS application message advances the sender ratchet. If the browser persisted the advanced provider state but crashed before the ciphertext reached the server, the message ciphertext could be lost even though that generation had already been consumed.

## Durable prepare-before-network
The encrypted local state now contains `pendingApplicationSends`.

For each outbound message/edit/reaction/delete:
1. advance OpenMLS sender ratchet and create the final MLS ciphertext;
2. store ciphertext envelope, client id, decrypted event and server routing metadata inside the encrypted local state;
3. persist that state before any network request;
4. POST using the durable client id;
5. on successful idempotent response, bind server message id/sender/sequence to the decrypted event journal;
6. remove the pending send and persist again.

If the network or final local commit fails, the same ciphertext and client id remain durable and are retried; the message is never re-encrypted under a new sender generation.

## Ordering with membership changes
Application sends are serialized behind a pending local membership transition. Before creating an add/remove commit, pending application sends must be drained. Incoming control-event processing also drains pending application sends first.

This prevents this client from knowingly carrying unsent old-epoch application messages across a local epoch transition.

## Offline behavior
Multiple encrypted sends may remain in the durable queue. They are retried in local creation order during initialization or the next operation that requires a clean transport boundary.

## Projection
After server acceptance, the sender's own plaintext event is journaled locally using the durable server message id/sequence. The sender never needs to decrypt its own MLS PrivateMessage echo.

## Remaining ordering risk
Application messages and MLS control events still use separate server sequences. A delayed old-epoch message from another sender can race a received commit. A transport-ordering / past-epoch policy gate remains required before UI activation.

## Next
Step 59: define and test cross-stream epoch ordering, either through a unified conversation transport sequence or a bounded past-epoch secret policy with explicit delivery rules.

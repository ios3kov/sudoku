# Step 53 — Two-phase MLS membership transitions

## Goal
Prevent the creator from advancing to a new MLS epoch before the corresponding Commit/Welcome is durably accepted by the delivery service.

## OpenMLS phase split
OpenMLS `stage_commit()` persists `PendingCommit` in provider storage. The epoch changes only at `merge_pending_commit()`.

The binding now follows that model:
- `addMember(...)` prepares Commit + Welcome and leaves PendingCommit;
- `removeMember(...)` prepares Remove Commit and leaves PendingCommit;
- `mergePendingCommit(groupId)` is explicit.

Application messages are blocked by OpenMLS while a membership transition is pending.

## Rust crash/reload proof
A native test prepares an Add commit, verifies application sends are blocked, exports provider state before merge, restores the provider, joins Bob from the prepared Welcome, merges Alice's restored PendingCommit and then proves messaging works.

Existing 2-party and add/remove/rekey tests were updated to merge explicitly after their simulated durable-delivery point.

## Atomic delivery-service batch
The API adds:

`POST /v1/e2ee/conversations/{conversation_id}/control-batches`

A batch carries 1–10 opaque Commit/Welcome events and is written in one PostgreSQL transaction.

Properties:
- one sender MLS device;
- stable per-event client ids;
- recipient user/device snapshots;
- monotonic crypto sequences;
- all-or-nothing creation;
- exact full-batch retry is idempotent;
- partial client-id collision returns 409;
- changed retry content/routing returns 409;
- realtime outbox still contains only control metadata, never MLS wire bytes.

## Browser crash-safe outbound transition
The encrypted local MLS state now includes an optional pending outbound transition containing the already-generated Commit/Welcome bytes, stable client ids and recipient snapshots.

Flow:
1. prepare OpenMLS membership transition;
2. persist provider PendingCommit + outbound batch in encrypted IndexedDB;
3. submit atomic server batch;
4. after success call `mergePendingCommit`;
5. persist merged provider state while retaining the retry marker;
6. clear the marker and persist again.

Crash cases:
- before server acceptance: restart retries the same batch;
- after server acceptance but before merge: retry returns existing events, then merge proceeds;
- after merge but before marker clear: retry is idempotent and OpenMLS merge on operational state is harmless.

Initialization flushes a pending outbound transition before normal control-event ACK recovery.

## API integration
The integration suite verifies:
- two-event Commit+Welcome batch receives consecutive crypto sequences;
- exact retry returns the same event ids;
- changed retry returns 409;
- batch events can be ACKed independently;
- the prior recipient-snapshot removal test still proves a removal Commit survives server membership deletion.

## Production gate
The visible composer is still not switched on. Remaining blockers include peer identity pinning/verification, encrypted attachments, device recovery/revocation UX and end-to-end browser smoke tests.

## Next
Step 54: bind validated KeyPackage credential/signature key to a locally pinned peer device identity and expose a human-verifiable fingerprint/QR payload. First contact remains unverified; key changes are blocked until explicitly re-verified.

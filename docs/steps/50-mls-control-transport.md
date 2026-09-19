# Step 50 — Durable MLS control transport

## Goal
Move MLS Commit/Welcome delivery from the Rust interoperability harness into the real authenticated application transport while keeping the server cryptographically blind.

## Device registry
A durable `mls_devices` table binds an authenticated user/device id to one immutable 32-byte MLS identity public key. Private identity material never reaches the server. Identity-key replacement requires a new device id, making unexpected identity changes explicit.

KeyPackage publication now requires an active registered MLS device. Device discovery remains stable even when the device has zero available KeyPackages.

## Control events
Opaque MLS `commit` / `welcome` wire bytes are stored in `mls_control_events` with a monotonic per-conversation crypto sequence.

Recipients are explicit user/device pairs snapshotted into `mls_control_recipients` at creation. The server validates that each recipient is an active registered device belonging to a conversation member at creation time.

A recipient can later fetch an event solely from that durable assignment, even if server-side conversation membership has already been removed. This prevents a removal commit from disappearing due to a race with membership mutation.

## Realtime
The transactional outbox publishes only:
- control event id;
- kind;
- crypto sequence.

The MLS wire payload itself is not copied into Redis/realtime logs. Clients wake on `mls.control.created` and fetch the durable bytes over the authenticated endpoint.

## Ack
Each recipient device explicitly acknowledges processing. Unacked events remain fetchable and ordered by the conversation crypto sequence.

## Idempotency
`(sender_user_id, sender_device_id, client_id)` is unique. A retry with identical content returns the existing event; reusing the client id with different payload/routing returns 409.

## Integration test
The test verifies:
1. sender/recipient register stable MLS devices;
2. an encrypted conversation creates a control event;
3. raw MLS bytes are stored only in the durable control row;
4. realtime outbox metadata does not contain the raw payload;
5. the recipient membership row is deleted after event creation;
6. the snapshotted recipient device can still fetch the removal commit;
7. ack removes it from the pending feed.

## Next
Step 51: wire the browser MLS adapter to register its identity, publish KeyPackages, consume durable Commit/Welcome events, ack only after successful OpenMLS processing, and persist provider state after every mutation.

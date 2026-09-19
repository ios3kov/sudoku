# Step 67 — MLS membership delivery phase

## Finding
The first two-phase server choreography froze E2EE application traffic immediately when a membership change was prepared.

That is too early. A crash-recovered client may already have durable old-epoch application ciphertext waiting to send. If prepare freezes the server before the adapter flushes that outbox, the pending application blocks the MLS transition and the MLS transition blocks the application: a deadlock.

## Correct phase boundary
A prepared membership change has not changed the MLS epoch. Existing active members may continue to deliver old-epoch application ciphertext.

The freeze begins only after the first durable MLS control event tagged with that membership change exists. At that point a Commit/Welcome transition is in delivery and all application sends remain blocked until finalize.

Because the unified transport ledger orders application/control events, any application accepted before the tagged control batch is processed in the old epoch before the Commit. Traffic after control delivery is rejected until the membership transition completes.

## Implementation
Message creation now checks:
1. pending membership change;
2. whether any `MlsControlEvent` tagged with that change has been persisted.

Only the second condition blocks E2EE application creation.

## Regression test
The integration test proves:
- application ciphertext succeeds before prepare;
- succeeds after prepare but before control delivery;
- a tagged Welcome batch is durably accepted;
- subsequent application ciphertext returns 409 until finalize.

## Security
The change does not permit traffic across a delivered epoch transition. It narrows the freeze to the correct protocol phase and prevents crash-recovery deadlock.

# Step 59 — Unified E2EE transport ordering

## Goal
Give MLS application messages and MLS control messages one durable total order per conversation so clients do not apply a rekey commit before an older application ciphertext.

## Ledger
`conversation_transport_events` assigns a single monotonically increasing sequence under the existing conversation row lock.

Each ledger row references exactly one:
- durable message; or
- durable MLS control event.

The existing message sequence and MLS control sequence remain for their local APIs, but cryptographic processing order is defined only by the transport sequence.

## Migration
Migration 0011 backfills existing development data by ordering message/control rows by creation time with deterministic tie-breakers, then advances each conversation's next transport sequence.

## Feed
A device-specific authenticated transport endpoint returns visible ledger items strictly ordered by transport sequence.

Current members receive application-message items. MLS control items require an explicit snapshotted control-recipient assignment.

A removed user therefore cannot fetch later conversation messages, while a previously assigned removal commit remains retrievable.

## Security property
A client consuming this feed sequentially can process:
old-epoch application -> commit -> new-epoch application
without retaining arbitrary old epoch secrets merely to compensate for server stream reordering.

## Integration test
The API test creates an E2EE message, an MLS commit, then another E2EE message. The recipient feed must return transport sequences 1/2/3 in exactly that cross-stream order and support cursor catch-up.

## Next
Step 60: persist a per-conversation transport cursor in the encrypted browser state and consume the unified feed sequentially, ACKing control events only after the same durable local-state commit.

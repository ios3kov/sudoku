# Step 56 — Deterministic encrypted-event projection

## Goal
Apply decrypted MLS message/edit/reaction/delete events locally without server-readable mutation state and without double-application after reconnect or replay.

## Model
Projection is a pure rebuild from decrypted event records:
- deduplicate by durable event/message id;
- sort by server sequence, then event id as deterministic tie-break;
- replay from the beginning to produce visible message state.

This avoids hidden incremental state and makes reconnect/reload replay deterministic.

## Authorization rules enforced client-side
Because edit/reaction/delete targets are encrypted and opaque to the server:
- only the original message sender may edit it;
- only the original sender may delete it;
- any group member may react as themselves;
- events targeting missing/deleted messages fail closed.

## Delete semantics
Encrypted delete clears visible body, reply target and attachment metadata in the projection. The durable server ciphertext remains opaque history; the UI projection no longer exposes deleted content.

## Tests
Domain tests cover:
- duplicate/reordered replay produces identical output;
- unauthorized edit/delete rejection;
- delete clears projected content;
- reaction add/remove idempotency;
- missing-target events fail closed.

## Next
Step 57: connect this projection to ConversationView history/realtime catch-up and the concrete OpenMLS adapter, while keeping legacy plaintext conversations on their existing path.

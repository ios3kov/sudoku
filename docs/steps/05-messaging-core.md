# Step 05 — Messaging Core + Realtime Transport

## Goal

Implement the durable message path before adding richer UI/media features.

## Implemented

- Authenticated user directory.
- Direct and group conversation creation/listing.
- Stable direct-conversation deduplication using `direct_key`.
- Cursor-style message history by per-conversation sequence.
- Idempotent message creation keyed by `(sender_id, client_id)`.
- Per-conversation row lock before allocating sequence numbers, including duplicate re-check after lock acquisition.
- Reply validation within the same conversation.
- Message edit/delete.
- Reaction toggle events.
- Read watermark updates.
- Transactional outbox rows committed with message mutations.
- Celery beat dispatcher drains outbox using `FOR UPDATE SKIP LOCKED`.
- Redis per-user fan-out channels.
- Authenticated WebSocket endpoint consuming the same secure session cookie.
- Presence TTL refreshed by heartbeat.
- Typing events are authorized against conversation membership and fan out ephemerally through Redis.
- Direct conversation creation uses a PostgreSQL advisory transaction lock to eliminate pair-creation races.
- Message edits/deletes and conversation creation write content-free audit events.
- Reconnect durability is REST-based: clients request messages after their last known per-conversation sequence; Redis is never the history source.

## Reliability properties

1. Message exists in PostgreSQL before realtime publication.
2. Worker crash leaves `published_at = null`, so the event is retried.
3. Duplicate HTTP retries return the existing message rather than inserting another one.
4. Redis loss can delay realtime delivery but cannot delete message history.

## Deliberately not completed in this step

- Attachments and voice notes are a later MVP step after signed upload/storage validation.
- E2EE uses the reserved encryption fields in a later hardening milestone; current text messages are server-readable over TLS and encrypted storage.

## Verification

Python syntax compilation is run after this step. Full DB/Redis integration requires services not present in the current execution environment.

## Next step

Build the real mobile conversation UI, IndexedDB outbox, WebSocket reconnect/catch-up, and then asset uploads + push subscriptions.

# Step 13 — Search and Conversation Preferences

## Goal

Close the remaining everyday-chat UX gap before full service-backed verification: finding text in a conversation and controlling per-user conversation visibility/notification behavior.

## Implemented

- Membership-gated, rate-limited message text search within a single conversation.
- Deleted messages are excluded from search results.
- Per-member `is_pinned` and `notifications_muted` fields with Alembic migration `0005_conversation_preferences`.
- Pinned conversations sort above unpinned conversations for that user.
- Muting suppresses Web Push for that user/conversation only; realtime WebSocket events and durable history still work normally.
- Mobile Find in chat UI with result jump/highlight.
- Mobile conversation preferences panel for pin/unpin and mute/unmute.
- Audit event records preference changes without message content.

## Verification

- Domain tests: 7/7 pass.
- Python `compileall`: pass.
- JSON/YAML parse checks: pass.
- Secret-pattern scan: pass.
- Integration harness now asserts search results plus persisted pin/mute preferences. Full integration execution still requires PostgreSQL, Redis, S3 and the declared Python dependencies.

## Scale note

MVP search uses PostgreSQL `ILIKE` and is intentionally conversation-scoped with a capped result set. Before large histories, move to PostgreSQL full-text/trigram indexing or a dedicated search service; do not add an external search dependency until measurements justify it.

## Next step

Run the complete service-backed CI path and Next.js production build in a network-enabled runner, fix all runtime defects, then perform mobile/PWA smoke testing before deployment.

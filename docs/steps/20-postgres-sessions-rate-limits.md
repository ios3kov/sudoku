# Step 20 — PostgreSQL integration, device sessions, rate limits

## Goal
Turn Step 19 auth from compile/unit coverage into a real service-backed security path.

## Implemented
- Alembic initial PostgreSQL migration for users, sessions and invites.
- Redis fixed-window limits for login IP/email, invite acceptance and invite issuance.
- Active device-session listing.
- User-owned session revocation; revoking the current session clears its cookie.
- PostgreSQL + Redis integration test covering login, `/me`, session listing and current-device revocation.
- CI service containers run migration before integration tests.

## Reliability/security
- Session authorization remains PostgreSQL authoritative.
- Redis contains only rate-limit counters and may not grant authorization.
- Raw session/invite tokens remain absent from persistent storage.

## Verification
CI must pass migration upgrade, Python compile/unit tests and the PostgreSQL/Redis integration test.

## Next
Step 21: conversations, ordered/idempotent messages and transactional outbox.

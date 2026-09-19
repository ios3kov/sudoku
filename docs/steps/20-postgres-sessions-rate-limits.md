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

## CI finding
The first service-backed run exposed a migration-runner defect: Alembic exited successfully while the online environment configured and ran migrations in separate sync callbacks, leaving no application tables. The integration test correctly failed on `relation "invites" does not exist`.

## Fix
- Online Alembic now configures, begins the transaction and runs migrations inside one synchronous callback on the same connection.
- CI now immediately asserts that `alembic_version`, `users`, `sessions` and `invites` exist after `alembic upgrade head`.
- Auth integration tests run only after that schema assertion.

## Reliability/security
- Session authorization remains PostgreSQL authoritative.
- Redis contains only rate-limit counters and may not grant authorization.
- Raw session/invite tokens remain absent from persistent storage.

## Verification
Step completes only when migration schema assertion and auth integration tests both pass against real PostgreSQL/Redis services.

## Next
Step 21: conversations, ordered/idempotent messages and transactional outbox.

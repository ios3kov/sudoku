# Step 03 — Invite-only Auth + Device Sessions

## Goal

Make the hidden surface depend on real server authentication rather than the concealment gesture.

## Implemented

- FastAPI API foundation.
- PostgreSQL SQLAlchemy models for users, sessions, invites, audit events, and login attempts.
- Argon2id password hashing.
- Random opaque session tokens; only SHA-256 token digests are persisted.
- Secure HttpOnly session cookie configuration.
- Login, logout, session rotation, current-user, session listing, and session revocation endpoints.
- Invite acceptance with row locking, expiration/use checks, and optional email binding.
- Redis login throttling by IP and normalized email.
- Same-origin mutation middleware for browser CSRF hardening.
- Audit events for authentication/session lifecycle.
- Alembic initial auth migration.

## Security properties

- Knowing the Sudoku gesture grants zero API access.
- Stolen database contents do not contain raw session tokens.
- Individual device sessions can be revoked.
- Account enumeration is reduced by using a generic login failure response.
- Invite tokens are stored hashed.

## Verification

- Python syntax/bytecode compilation is run for every API module and migration.
- Runtime integration tests require PostgreSQL/Redis and Python dependencies; those services are not available in the current execution container.

## Next step

Wire the web hidden gate to `/v1/me` + login, then implement conversations/messages with transactional outbox and WebSocket delivery.

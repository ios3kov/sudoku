# Step 19 — FastAPI invite-only authentication

## Goal
Restore the first server-side security boundary directly in the repository.

## Implemented
- FastAPI API workspace with async SQLAlchemy/PostgreSQL configuration.
- Users, opaque device sessions, and one-use invite models.
- Argon2 password hashing.
- Random session tokens; only SHA-256 token digests are persisted.
- Secure/HttpOnly/SameSite session cookie configuration.
- `GET /v1/me`, login/logout, admin invite creation, invite acceptance.
- Invite acceptance row-locks the invite and enforces expiry/email/one-use semantics.
- Unit tests cover password hashing and session-token digest behavior.

## Security boundary
The hidden Sudoku gesture has no server authority. `/v1/me` and all future messenger APIs require a valid non-revoked server session.

## Deferred to Step 20
- Redis login/action rate limiting.
- Device-session list/revocation UI/API.
- Conversations/messages and transactional outbox.
- Full PostgreSQL integration test in CI.

## Verification
CI adds Python dependency install, bytecode compilation and security unit tests.

## Next
Add PostgreSQL service-backed migration/integration tests, then conversations/messages.

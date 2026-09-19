# Progress

## Current milestone
Direct-source recovery of the production MVP.

## Repository truth

### Step 17 — Direct source import
- Broken multipart bootstrap removed from `main`.
- Application code is committed as ordinary Git objects.
- Normal CI established.

### Step 18 — Web PWA + auth gate
- Next.js PWA branded only as Sudoku.
- Real 9x9 Sudoku shell.
- Hidden `5 -> upward swipe` gesture.
- Private surface requires `GET /v1/me`.
- 30-second background privacy return.

### Step 19 — FastAPI invite-only auth
- FastAPI + async SQLAlchemy/PostgreSQL foundation.
- Users, one-use invites, opaque revocable session records.
- Argon2 passwords.
- Raw session/invite tokens are not persisted; SHA-256 digests are.
- Login/logout/current-user/admin invite/accept-invite endpoints.
- Security unit tests added.

## Verification
- Step 17 domain CI: passed.
- Step 18 domain tests: passed; web typecheck/build is running at the time Step 19 source is prepared.
- Step 19 CI adds Python compile + security unit tests.
- PostgreSQL-backed integration is not yet claimed.

## Next step
Step 20: Alembic migration + PostgreSQL service integration + device-session revocation + Redis rate limiting. Then restore conversations/messages.

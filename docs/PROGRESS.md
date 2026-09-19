# Progress

## Current milestone
Direct-source production MVP.

## Repository truth

### Step 17 — Direct source import
- Broken multipart bootstrap removed.
- Normal Git source tree + CI established.

### Step 18 — Web PWA + auth gate
- Sudoku-branded Next.js PWA.
- Real 9x9 board and hidden `5 -> upward swipe`.
- Hidden surface requires server auth.
- 30-second privacy return.
- Initial CI exposed workspace typing defects; corrected and verified.

### Step 19 — FastAPI invite-only auth
- Async FastAPI/PostgreSQL foundation.
- Argon2 users, one-use admin invites, opaque hashed sessions.
- Login/logout/`me`/invite endpoints.
- API compile/security tests pass.
- Corrective CI after tree-history regression: full domain + web + API passed.

### Step 20 — PostgreSQL sessions + rate limiting
- Alembic auth migration.
- Redis login/invite rate limits.
- Device session list and revocation.
- PostgreSQL/Redis service-backed auth integration test.
- CI now runs real migration + integration test.

## Verification
- Commit `e76b153`: domain ✓, web typecheck ✓, Next production build ✓, API compile/tests ✓.
- Step 20 service-backed CI pending after commit.

## Next step
Step 21: conversations + ordered/idempotent messages + transactional outbox.

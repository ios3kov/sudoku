# Step 09 — Security and Operations Hardening

## Goal

Close production blockers found during code review before adding more surface area.

## Implemented

### Auth / invite administration

- Added `users.is_admin` with migration `0004_admin_invites`.
- Added admin-only `POST /v1/invites` and `DELETE /v1/invites/{invite_id}`.
- Raw invite token is returned only at creation; the database stores only SHA-256 token hashes.
- Added first-user `bootstrap-admin` CLI. Password is entered via a hidden terminal prompt, not a command-line argument.
- Added a private admin invite UI that creates one-use, seven-day codes.

### WebSocket / abuse controls

- WebSocket cookie authentication now requires the exact configured `PUBLIC_ORIGIN`, preventing cross-site WebSocket hijacking.
- Added authenticated rate limits for user search, conversation creation, message creation/edit/delete, reactions, uploads, push subscription changes and invite administration.
- Invite acceptance has a separate IP rate limit.
- Typing events are locally throttled per WebSocket connection.

### Storage lifecycle

- Rejected uploads are deleted from object storage immediately on a best-effort basis.
- A Celery cleanup task runs every six hours and removes stale pending/rejected objects plus ready objects that were never attached to a message.
- S3 deletion occurs before DB deletion, making cleanup retries idempotent.

### Push SSRF boundary

- Push subscription endpoints must use HTTPS/443 and match a configured push-service hostname allowlist.
- Default allowlist covers Apple (`*.push.apple.com`), Google FCM (`fcm.googleapis.com`) and Mozilla (`*.push.services.mozilla.com`).
- Push subscription mutation is rate-limited.

### Code-review fix

- Fixed a runtime model bug: `UniqueConstraint` was referenced but not imported. `compileall` cannot catch that class of error, so runtime-import checks were added to the verification routine where dependencies permit.

## Verification

- Python `compileall`: pass.
- `app.models` and `app.schemas` runtime imports: pass.
- Full package import is blocked only by the current environment lacking the `asyncpg` runtime dependency; this is an environment limitation, not treated as a passing integration check.
- Web/domain TS/TSX syntax transpile: pass.
- Domain tests: 7/7 pass.

## Next step

Add deployable local infrastructure (PostgreSQL, Redis, S3-compatible object storage), execute Alembic against a real database, run API integration tests, then run the Next.js build and mobile E2E smoke tests.

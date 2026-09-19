# Progress

## Current milestone

MVP implementation + production hardening.

## Completed

### Step 01 — Product specification

- Product boundaries defined.
- Security/concealment distinction documented.
- Architecture, API, data model, and reliability defaults documented.

### Step 02 — PWA Sudoku shell

- Monorepo foundation created.
- Dependency-free Sudoku domain engine implemented.
- One complete 9x9 puzzle and solution included.
- Conflict validation, candidate calculation, completion validation implemented.
- Hidden `5 -> upward swipe` gesture implemented as a deterministic state machine.
- Next.js PWA shell files created.
- Manifest identifies the app as `Sudoku`.
- Service worker provides app-shell caching and generic Sudoku-only push presentation.
- Client auto-hides messenger mode after background timeout.

### Step 03 — Invite-only authentication

- FastAPI auth foundation implemented.
- PostgreSQL users/sessions/invites/audit schema implemented.
- Argon2id passwords and hashed opaque session tokens implemented.
- Login rate limits use Redis.
- Device session listing/revocation and session rotation implemented.
- Invite acceptance is transactional and row-locked.

### Step 04 — Web authentication gate

- Hidden gesture now enters a real session gate.
- `/v1/me` determines whether MessengerShell may render.
- Login and invite acceptance forms are wired to the FastAPI auth contract.
- Logout revokes the server session and returns to Sudoku.
- No credentials are persisted in browser storage.

### Step 05 — Messaging core

- Direct/group conversations implemented.
- Idempotent ordered message creation implemented.
- Edit/delete/reactions/read watermarks implemented.
- Transactional outbox + Celery dispatcher implemented.
- Redis user fan-out and authenticated WebSocket endpoint implemented.
- PostgreSQL remains the durable source of truth.

### Step 06 — Mobile chat client

- Conversation list and direct-chat creation implemented.
- Message history/send/read UX implemented.
- WebSocket reconnect + REST sequence catch-up implemented.
- Encrypted IndexedDB offline outbox implemented.
- Push click now forces Sudoku before focusing an existing window.

### Step 07 — Assets + masked push

- Signed S3-compatible uploads and stable authenticated content URLs implemented.
- Server-side size/SHA-256/file-signature verification implemented.
- Image/file messages and mobile attachment UI implemented.
- Web Push subscription storage/delivery implemented.
- Notifications contain only generic Sudoku presentation and always return to Sudoku on click.

### Step 08 — Messenger UX

- Group creation, replies, edit/delete, reactions and voice notes implemented.
- Read watermarks exposed per member and rendered as sender read state.
- Mobile chat action/composer structure reviewed and corrected.

### Step 09 — Security/operations hardening

- Admin-only invite issuance/revocation and first-admin bootstrap implemented.
- WebSocket exact-Origin enforcement implemented.
- Authenticated action rate limits and typing throttling implemented.
- Rejected/orphan upload cleanup implemented.
- Push endpoint SSRF allowlist implemented.
- Runtime `UniqueConstraint` import defect found by review and fixed.

### Step 10 — Runtime infrastructure + integration harness

- Container/runtime definitions added for API, web, PostgreSQL, Redis, local S3-compatible storage and Caddy.
- Readiness checks cover PostgreSQL, Redis and object storage.
- Alembic-before-startup and worker readiness dependencies added.
- Service-backed integration test flow and CI workflow added.
- Internal S3 endpoint is separated from browser-visible presign endpoint.

### Step 11 — Observability

- OpenTelemetry traces and metrics added with optional OTLP/HTTP export.
- FastAPI, SQLAlchemy, Redis and Celery instrumentation added.
- Celery instrumentation initializes after worker fork.
- Structured JSON logging added with trace correlation and sensitive-field redaction.
- Low-cardinality HTTP/business metrics added without message/user identifiers.
- Health polling excluded from normal access telemetry to reduce noise/cost.

### Step 12 — Group + device management

- Group rename/member add/remove/role management implemented.
- Last-owner invariant enforced server-side under conversation row lock.
- Durable removal events reach removed members through explicit outbox recipients.
- Mobile group settings UI added.
- Active device sessions are visible and remotely revocable.
- Revoking the current device clears the session cookie and returns to Sudoku.

## Verification

- Domain TypeScript compilation: passed.
- Domain unit tests: 7/7 passed (re-run after Step 12).
- Python syntax/bytecode compilation: passed.
- `app.models` + `app.schemas` runtime imports: passed.
- Web/domain TS/TSX syntax parse: passed (27 files after Step 12).
- Compose and GitHub Actions YAML parse successfully.
- OpenTelemetry/structlog source compiles, but the current Python environment is missing part of the newly declared runtime dependency set.
- Full API integration tests: pending real PostgreSQL/Redis/S3 services; current container also lacks `asyncpg`.
- Full Next.js build: pending dependency installation; current environment cannot reach the npm registry.
- Docker/Podman are unavailable in the current execution environment, so Compose has not been started here.

## Next MVP step

Add search/pin/mute UX, then install all declared dependencies in a network-enabled runner and execute migrations + real-service API integration tests + Next production build before deployment.

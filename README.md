# Sudoku

Private invite-only messenger behind a real installable Sudoku PWA shell.

## Implemented MVP

- Real 9x9 Sudoku shell + hidden gesture.
- Invite-only authentication and revocable device sessions.
- Direct/group messaging, replies, edits/deletes, reactions and read state.
- Realtime WebSocket delivery + PostgreSQL catch-up.
- Encrypted IndexedDB text outbox for offline retry.
- Verified S3-compatible image/file/voice assets.
- Generic Sudoku-only Web Push presentation.
- Group/device management, search, pin/mute preferences.
- PostgreSQL transactional outbox, Redis fan-out, Celery workers.
- OpenTelemetry + structured privacy-safe logs.
- Production Docker/Caddy configuration.

The hidden gesture is presentation privacy only. Server authentication and authorization protect all private data.

## Verification

The enhanced pre-production pipeline passes with real PostgreSQL + Redis + in-process S3-compatible storage:

- migrations, API integration, Python lint and dependency audit
- pinned OpenMLS Rust tests + browser WASM build + RustSec audit
- canonical npm clean install, npm audit, ESLint and JSX/CSS contract
- domain tests + 10k-event encrypted projection profile
- TypeScript declarations/typecheck + Next production build
- bundle/WASM performance budgets
- Chromium E2EE + mobile UI acceptance against the production build
- production Compose policy validation
- production API/Web Docker image builds with non-root user assertions

Security hardening after the baseline includes strict mutation/WebSocket Origin checks, CSP/edge egress controls, app-switcher privacy cover, serialized session rotation, immediate concealment after remote session revocation, realtime membership/session revalidation, push SSRF allowlisting, private-response no-store policy and sensitive URL/log suppression.

A live production deployment/mobile smoke test is still required before calling the service production-verified.

## Local

```bash
docker compose up -d --build
```

Local entry point: `http://localhost:8080`.

## Production

Create `.env.production` from `.env.production.example`, replace every placeholder, configure DNS for both `APP_DOMAIN` and `assets.APP_DOMAIN`, then run the fail-closed preflight:

```bash
chmod 600 .env.production
ENV_FILE=.env.production bash scripts/preflight-production.sh
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --build --remove-orphans
APP_DOMAIN=<host> bash scripts/smoke-production.sh
```

Only Caddy ports 80/443 should be publicly exposed by the production Compose stack. Production is not verified until the physical-device and live-infrastructure checklist in `docs/steps/70-live-verification.md` passes. See `docs/steps/31-production-compose.md` and `docs/PROGRESS.md` for the security boundary and current status.

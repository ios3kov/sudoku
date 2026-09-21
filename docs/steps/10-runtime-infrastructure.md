# Step 10 — Runtime Infrastructure and Integration-Test Harness

## Goal

Make the repository deployable/testable as a complete system rather than a set of disconnected source modules.

## Implemented

- API Docker image (Python 3.13).
- Web Docker image (Node 22 + production Next build).
- Local Compose stack: PostgreSQL, Redis, S3-compatible object store, API, Celery worker, Celery beat, web and Caddy reverse proxy.
- Local Caddy routes `/v1/*` (including WebSocket upgrade) to FastAPI and all other requests to Next.js.
- S3 internal endpoint and browser-visible presign endpoint are separate configuration values.
- Local bucket initialization includes browser CORS for the app origin.
- `/v1/health/ready` verifies PostgreSQL, Redis and object storage.
- Alembic migrations run before API startup; workers wait for API readiness.
- GitHub Actions workflow added for migrations, real-service API integration tests, domain tests, web typecheck and production build.
- API integration flow covers admin login, hashed invite issuance, invite acceptance, direct chat, idempotent retry, durable message read, wrong-Origin rejection, signed upload/verification/download authorization, and push-endpoint SSRF rejection.

## Reproducibility status

The repository now has a canonical `package-lock.json`, CI uses reproducible clean installs, and npm dependency auditing is part of the release gate. The earlier no-lockfile limitation from this bootstrap step is closed.

## Object-store note

The project keeps an S3-compatible API boundary. Current production uses the repository's pinned MinIO infrastructure behind Caddy: MinIO is private inside Docker and browser access goes through the dedicated TLS asset hostname. The application uses a dedicated least-privilege S3 credential rather than the MinIO root credential.

## Verification

The original Step 10 bootstrap verification has since been superseded by the enhanced CI and live Step 70 work:
- Compose policy validation runs in CI;
- real API/Web production images are built in CI;
- PostgreSQL/Redis/S3-backed integration tests run in CI;
- non-root container users and production port publication are asserted;
- the live Selectel stack has been started successfully on a verified production commit.

Current operational state is tracked in `docs/PROGRESS.md`, `docs/PRODUCTION.md` and `docs/steps/70-live-verification.md`.

## Next step

Complete Step 70 live/physical verification, including the latest release deploy, persistence/reboot, destructive backup/restore, two-device MLS and installed iOS/Android PWA smoke.

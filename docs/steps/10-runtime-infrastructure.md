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

## Important reproducibility note

The active execution environment cannot reach npm, so a lockfile could not be generated here. CI currently uses `npm install` so the verification pipeline remains executable. Before production release, CI must generate/review/commit `package-lock.json` and switch to `npm ci`; until then dependency resolution is not fully reproducible.

## Object-store note

The bundled object store is for local/integration development only. Production remains generic S3-compatible storage; do not treat the local service/image as the production storage recommendation.

## Verification

- Compose YAML parses successfully.
- Docker/Podman are not installed in the current execution environment, so containers cannot be launched here.
- Integration tests are committed but cannot be executed locally until PostgreSQL/Redis/S3 services and `asyncpg` are available.

## Next step

Add OpenTelemetry/structured observability, generate the npm lockfile in a network-enabled runner, then execute CI/service-backed tests and fix any real integration failures before deployment.

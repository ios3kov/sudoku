# Sudoku

Private invite-only messenger hidden behind a real Sudoku PWA shell.

## Current implementation status

Steps 01–13 are implemented in the current working snapshot: Sudoku PWA shell, invite-only auth, realtime messaging, offline outbox, assets, masked push, groups, device sessions, search, and per-user conversation preferences.

The hidden gesture is only a UI concealment mechanism; authorization is always enforced server-side. Full service-backed CI and production build verification are still required before deployment.

## Planned production stack

- Web: Next.js 16.3.3, TypeScript, Zustand, Tailwind CSS
- API: FastAPI + PostgreSQL
- Realtime: WebSocket gateway + Redis fan-out
- Jobs: Celery + Redis
- Storage: S3-compatible object storage
- Observability: OpenTelemetry + structured logs + metrics

## Local development

Dependency installation is required before the web app can run:

```bash
npm install
npm run dev:web
```

The domain package has no runtime dependencies and can be verified independently:

```bash
npm run test:domain
```

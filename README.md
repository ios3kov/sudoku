# Sudoku

Private invite-only messenger hidden behind a real Sudoku PWA shell.

## Current implementation status

The repository contains the production-oriented MVP implementation and living documentation under `docs/`.

## Stack

- Web: Next.js + TypeScript + Zustand + Tailwind
- API: FastAPI + PostgreSQL
- Realtime: WebSocket + Redis
- Jobs: Celery + Redis
- Storage: S3-compatible
- Observability: OpenTelemetry + structured logs + metrics

## Verification

Run the dependency-free domain checks with:

```bash
npm run test:domain
```

See `docs/PROGRESS.md` for current implementation and verification status.

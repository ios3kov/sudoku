# Step 31 — Production deployment configuration

## Finding
The base Compose file is intentionally local-development configuration: HTTP origin, insecure cookies, localhost S3 public endpoint and local Caddy port. Reusing it unchanged in production would weaken session/origin behavior and break browser asset uploads.

## Fix
- Added a separate `compose.production.yaml` override.
- Production requires `APP_DOMAIN`, database/storage credentials and VAPID keys via Compose required-variable syntax.
- Production forces HTTPS `PUBLIC_ORIGIN` and `SECURE_COOKIES=true`.
- Caddy binds 80/443 and uses the production TLS config.
- Internal object-store ports are not published by the production override.
- Added `.env.production.example` containing names/placeholders only, no secrets.

## Deployment command
`docker compose -f compose.yaml -f compose.production.yaml --env-file .env.production up -d --build`

## Remaining external prerequisites
- DNS A/AAAA for `APP_DOMAIN`.
- Production-grade PostgreSQL/Redis/S3 backups and monitoring.
- Real VAPID key pair.
- Firewall exposing only 80/443 publicly.
- Initial admin bootstrap.
- Live mobile PWA/push smoke test.

## Status
Repository/CI readiness is not the same as a verified live deployment. Do not call production complete until the live smoke test passes.

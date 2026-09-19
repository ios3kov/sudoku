# Progress

## Current milestone
Repository MVP accepted; production deployment preparation.

## Verified baseline
Commit `90ca6cd` passed the complete acceptance pipeline: PostgreSQL/Redis/S3 integration, migrations, full API MVP flow, domain tests, declarations, web typecheck and Next production build.

## Security hardening
- Step 26: immediate Sudoku privacy cover on background/app switcher; >=30s locks private state.
- Step 27: exact Origin required for browser mutations.
- Step 28: realtime sessions revalidate; connection-scoped presence; push suppression follows live connections.
- Step 29: concurrent session refresh serialized by row lock + recheck.
- Step 30: storage ACL, signed downloads, push SSRF, SW cache exclusions, realtime membership reviewed.
- Sensitive URL logging hardening commit `27d0119`: full CI ✓.
- Origin/realtime/session hardening commits: full CI ✓.

## Production configuration
Step 31 adds a fail-closed production Compose override:
- HTTPS public origin.
- Secure cookies.
- Required domain/secrets/storage/VAPID values.
- Caddy TLS on 80/443.
- No public object-store admin/data ports from the bundled local service.

## What is NOT yet verified
- Live DNS/TLS.
- Real production PostgreSQL/Redis/S3 durability/backups.
- Real VAPID delivery on iOS/Android.
- Add-to-Home-Screen behavior on physical devices.
- App-switcher concealment on physical iOS/Android.
- Live worker/beat/realtime behavior under deployment networking.

## Next step
Provision production infrastructure and secrets, deploy, bootstrap the first admin, then run the live mobile/PWA smoke checklist. Do not mark production complete until that passes.

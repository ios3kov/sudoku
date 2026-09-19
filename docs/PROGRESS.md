# Progress

## Current milestone
MVP acceptance + security hardening.

## Verified baseline
Commit `90ca6cd` passed the complete acceptance pipeline: PostgreSQL/Redis/S3 integration, migrations, full API MVP flow, domain tests, domain declarations, web typecheck and Next production build.

## Hardening review

### Step 26 — Privacy lifecycle
Immediate Sudoku cover on background/app switcher; >=30s background locks private state before reveal.

### Step 27 — Origin boundary
All browser POST/PUT/PATCH/DELETE requests require exact configured Origin. Missing or wrong Origin is 403.

### Step 28 — Realtime sessions/presence
WebSocket sessions revalidate on heartbeat/actions; revoked sessions close. Presence is connection-scoped and push suppression recognizes any live connection.

### Step 29 — Session rotation
Refresh row-locks and rechecks the current session so concurrent refresh cannot mint multiple replacements.

### Step 30 — Review summary
Storage ACL, signed downloads, push SSRF controls, service-worker cache exclusions, realtime membership and sensitive logging were reviewed; no additional code change was required for those boundaries.

## Current verification
- Baseline full acceptance: ✓.
- Privacy hardening commit `2580c82`: full CI ✓.
- Later Origin/realtime/session-rotation hardening: CI runs pending/current.
- Production deployment and live mobile smoke are not yet claimed.

## Next step
Require one full green CI on the latest hardening HEAD. Then prepare production deployment configuration and run live PWA/mobile smoke tests.

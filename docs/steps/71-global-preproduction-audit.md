# Step 71 — Global pre-production audit, polish and profiling

## Scope
A full repository-level pre-production pass was performed before choosing or provisioning the live server.

Reviewed:
- UX/UI and mobile layout;
- accessibility and interaction states;
- encrypted-chat behavior and long-history ergonomics;
- browser/runtime performance;
- API/realtime authorization and privacy;
- E2EE lifecycle and device revocation;
- S3/MinIO production path;
- container hardening;
- backup/restore readiness;
- Python, Rust and Node dependency security;
- CI reproducibility and production-equivalent acceptance.

## P0/P1 findings closed

### UI stylesheet drift
The active JSX had outgrown the old global stylesheet. Many current messenger/Sudoku classes had no production styles.

Fix:
- rebuilt `globals.css` as a mobile-first design system;
- added safe-area support, consistent spacing, chat/composer/settings states, focus-visible treatment, reduced-motion behavior and responsive desktop constraints;
- CI now enforces a JSX/CSS class contract.

### Encrypted media and long-chat memory
Previously image/voice attachments could decrypt eagerly and long histories rendered without a DOM bound.

Fix:
- images decrypt only near the viewport;
- voice decrypts on demand;
- decrypted offscreen image/file object URLs are released;
- the chat initially renders the latest 120 messages and explicitly expands older history.

### Realtime scroll ergonomics
New realtime events forced the user to the bottom while they were reading old history.

Fix:
- auto-scroll now follows only when the user is already near the bottom.

### Invite-secret URL leakage
Invite secrets were previously embedded in the accept URL.

Fix:
- accept endpoint is `POST /v1/invites/accept`;
- the invite token is carried only in the JSON body.

### Pending-member asset authorization
A `pending_add` conversation member could satisfy the generic asset membership query.

Fix:
- asset authorization excludes `pending_add` members;
- API regression coverage verifies the boundary.

### Remote revoke presentation privacy
A server-side revoked session eventually lost API/WS access but could leave already-decrypted UI visible.

Fix:
- authenticated WebSocket close code 4401 stops reconnect;
- local MLS state/outbox are cleared;
- private UI is concealed immediately.

### Object-storage production path
The initial MinIO deployment path mixed internal/public endpoints and had Compose-time vs runtime interpolation hazards.

Fix:
- MinIO remains private on the Docker network;
- browsers use `https://assets.<APP_DOMAIN>`;
- Caddy terminates TLS for the object endpoint;
- CORS is production-origin specific;
- the app uses dedicated least-privilege S3 credentials;
- MinIO bootstrap variables are expanded inside the container at runtime.

### Container/runtime hardening
Fix:
- API/Web run as non-root users;
- production Compose drops capabilities and enables `no-new-privileges`;
- the final CI builds the real images and asserts the configured users.

### Reproducible Node build
The repository did not have a trustworthy canonical npm lockfile during the audit.

Fix:
- regenerated the lockfile with npm itself;
- validated it with `npm ci`;
- CI and Web Docker build use the lockfile.

## Security gates
- Ruff: pass.
- pip-audit: no known vulnerability.
- npm production audit: 0 vulnerabilities.
- RustSec/cargo-audit 0.22.2: no known vulnerability across 193 Cargo dependencies.
- Allowed RustSec maintenance warning: `proc-macro-error2 2.0.1` / RUSTSEC-2026-0173 (unmaintained), transitive through `hax-lib-macros 0.3.7`.
- Caddy: HSTS, CSP, no-referrer, frame denial, COOP/CORP, nosniff and Permissions-Policy.
- API private responses: `Cache-Control: no-store`.
- production E2EE creation gate remains mandatory.

## Performance profile
Measured on the GitHub Linux runner:
- encrypted projection: 10,000 events -> 25.16 ms;
- production JS chunks: 10;
- total JS gzip: 207,793 bytes;
- largest JS chunk gzip: 71,470 bytes;
- OpenMLS WASM raw: 2,709,987 bytes;
- service worker raw: 2,546 bytes.

CI fails if the web bundle/WASM exceeds the configured budget.

## Browser/mobile automated acceptance
Production-mode Chromium verifies:
- hidden Sudoku unlock;
- MLS bootstrap;
- encrypted send/reload/catch-up;
- second reload with persisted OpenMLS state;
- offline durable retry;
- fail-closed composer during transport outage;
- 390x844 mobile no-horizontal-overflow baseline;
- accessible button naming and auth keyboard order;
- immediate privacy cover on pagehide.

Result on code-gate commit `d082d984`: 2 Playwright scenarios passed.

## Operations
- production Compose policy is validated in CI;
- backup/restore scripts pass shell validation;
- API and Web production images build in CI;
- image users are asserted as `sudoku` and `node`;
- local backups/test artifacts are excluded from Git.

## P2 / deferred scaling work
1. `proc-macro-error2` is unmaintained but not vulnerable. Track through the OpenMLS/hax dependency chain.
2. Browser MLS state currently includes the decrypted event journal in one encrypted state blob. CPU projection is fast, but very large catch-up histories can create IndexedDB write amplification. Re-profile on physical mobile hardware before scaling past the invite-only MVP.

Neither item is a current P0/P1 deployment blocker for the intended small invite-only launch.

## Stop result
Automated pre-production audit stop criteria are met:
- no open P0/P1 finding in audited scope;
- enhanced CI green;
- production-mode browser acceptance green;
- dependency audits green for known vulnerabilities;
- production images build as non-root;
- performance budgets green.

External Step 70 remains mandatory before declaring the service production-verified.

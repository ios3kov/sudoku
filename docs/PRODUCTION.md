# Production Runbook

This document is the canonical non-secret description of the current Sudoku production environment.

It intentionally contains operational facts needed to deploy, verify and recover the service, while excluding credentials, private keys, session material, invite secrets and administrator allowlist addresses.

## Current production inventory

Last infrastructure setup verification: 2026-09-20 to 2026-09-21.

| Item | Current value |
| --- | --- |
| Provider | Selectel |
| Server name | `sudoku-prod` |
| Region / zone | Moscow, `ru-7a` |
| Public IPv4 | `185.31.167.36` |
| OS | Ubuntu 24.04 LTS |
| Host size | 2 vCPU, 4 GB RAM, 50 GB SSD |
| Deployment user | `deploy` |
| Repository path | `/home/deploy/sudoku` |
| Application hostname | `sudoku.moscow` |
| Encrypted-object hostname | `assets.sudoku.moscow` |
| Production env file | `/home/deploy/sudoku/.env.production`, mode `0600` |
| Reverse proxy / TLS | Caddy |
| Runtime | Docker Engine + Docker Compose |
| E2EE policy | `REQUIRE_E2EE_NEW_CONVERSATIONS=true` |

Docker and Compose versions were verified during provisioning and must continue to satisfy the repository preflight. The current production configuration depends on Compose support for `!reset` / `!override`.

## Release status

### Current checkpoint — 2026-09-23 phone/contact rollout deployed

Repository verification and production evidence remain separate, but the coordinated phone/contact release is now live.

- Deployed source: `c0f71313b92aaa8206eda036ecb819f796854f30`.
- Database: `0016_phone_contacts (head)`.
- Pre-deploy consistent backup: `./backups/20260923T160722Z`.
- Backup verification: checksum manifest passed; PostgreSQL custom dump was readable by `pg_restore -l`; live MinIO object count and backup object count were both zero; an off-host copy was transferred to the operator workstation and its checksums passed again.
- Production preflight passed before deployment.
- All production application images built successfully and the stack restarted healthy.
- Initial smoke observed two transient HTTP 502 responses while the new Web container had not yet started listening; the same smoke then completed successfully.
- Follow-up readiness returned PostgreSQL, Redis and object storage healthy and five consecutive application requests returned HTTP 200.
- The existing global administrator was migrated to a verified phone identity without replacing the account.
- Administrator phone login works.
- Four-digit PIN unlock and literal page reload return to a ready secure-messaging runtime without the former `Secure messaging needs a restart` failure.
- `assets.sudoku.moscow` has valid TLS and reaches the MinIO edge through Caddy; a root HEAD request may return an S3-style 400 while still proving the TLS/proxy path is alive.

Do not mark Step70 complete yet. The remaining live gates are the second-account/contact authorization flow, contact-removal send denial, two-device MLS direct/group/media/revocation, host-reboot persistence, destructive restore drill, and physical native-client acceptance.

The next release program is the native iOS track in [Step88](steps/88-native-ios-production-plan.md). It must not weaken the current server authorization, MLS, backup or exact-SHA deployment rules.

### Historical checkpoint — 2026-09-22

Repository verification and production evidence are separate.

- **Last operator-reported live smoke:** `1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b`, reported in [issue #38](https://github.com/ios3kov/sudoku/issues/38). Beat remained running with restart count `0 -> 0`; the worker executed empty outbox jobs; DNS, HTTPS, API readiness, asset TLS and redirects passed. This is bounded operator evidence, not a fresh host inspection or full Step70 acceptance.
- **Merged PIN candidate:** [PR #40](https://github.com/ios3kov/sudoku/pull/40), `5205a4add164fdf84702afea870040413e5acfb9`. Its tree `38c0e5ee3188d314272371457daf2b37e8128983` exactly matches reviewed head `a2d86e2a5b1db458b5eff761583a2f6ff26d93d1`.
- **PR gate:** all three workflows completed successfully on that reviewed head: [CI #332](https://github.com/ios3kov/sudoku/actions/runs/35738803026), [device-access #15](https://github.com/ios3kov/sudoku/actions/runs/35738803218), [beat-runtime #17](https://github.com/ios3kov/sudoku/actions/runs/35738803136).
- **Exact post-merge gate:** [CI #333](https://github.com/ios3kov/sudoku/actions/runs/35741488200), [device-access #16](https://github.com/ios3kov/sudoku/actions/runs/35741488216), [beat-runtime #18](https://github.com/ios3kov/sudoku/actions/runs/35741488232). Their observed terminal results and release decision are recorded in [Step79](steps/79-device-pin-merge.md).
- **Production:** the PIN candidate has not been deployed by this step. No host command, migration, restart, backup/restore or secret/infrastructure change was performed. A separate deployment authorization and the release prerequisites below are required.

Deploy the immutable application candidate, not an arbitrary moving main ref. Documentation-only follow-ups do not designate a new application candidate or claim new full application CI. Any later code, dependency, workflow, build or infrastructure change requires its own exact-SHA gate.

The earlier backup at `/home/deploy/sudoku-safe-backups/20260922T111443Z` passed dump-structure and checksum checks only. A raw archive of a running MinIO volume plus a separately timed database dump is not evidence of a consistent database/object recovery point or a successful restore. Do not treat it as the new release's completed backup/restore gate.

Before the PIN rollout, establish a fresh consistent database/object backup and an explicit rollback plan. Apply `0015_session_pins` with the PIN-aware API before exposing PIN controls. After any session enables PIN, do not roll back to an API that ignores the PIN table while those sessions remain active. Prefer a forward fix; deliberate pre-PIN rollback requires controlled session revocation/password reauthentication, not blind schema downgrade. See [device-access design](features/device-access.md) and Step79.

Update live-release evidence only after the exact candidate is deployed and live smoke passes. Physical iOS/Android, two-device encrypted flows and controlled restore acceptance remain separate in [Step70](steps/70-live-verification.md).

### Phone identity migration boundary

PR #47 introduces migration `0016_phone_contacts`. Treat it as a coordinated API/web/database release; do not expose phone-contact UI against an API that does not enforce the contact graph.

For an existing legacy account, the user may assign a phone from Devices after password confirmation. That phone can authenticate immediately but remains undiscoverable until an operator verifies it out-of-band:

```bash
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml \\
  exec api python -m app.cli verify-phone --phone '<e164-phone>'
```

Changing a phone clears verification and inbound contact edges. Contact discovery therefore resumes only after verification and resync. Prefer a forward fix after `0016`; never automatically downgrade the database.

### Pending security migrations after the live phone rollout

Production is currently at `0016_phone_contacts`.

Repository work after that live release introduces:

- `0017_single_admin` — database-enforced singleton global administrator;
- `0018_session_biometrics` — per-session native biometric public key plus one-time challenge state.

Neither migration is live yet. Do not apply them piecemeal from a moving branch. The next backend rollout must use an exact fully-green merged SHA, a fresh consistent off-host backup, production preflight, normal migration/API/web restart, smoke, and explicit post-migration checks. Prefer a forward fix rather than automatic downgrade.

`0018_session_biometrics` stores no private biometric key, PIN or biometric template. It stores only the iOS P-256 public key and ephemeral challenge state. Changing/removing the PIN deletes the credential. The native private key remains Secure-Enclave-only and must be re-enrolled after PIN changes.

### Native iOS release boundary

The native iOS client is an additional release artifact, not a replacement for the production backend.

Rules:

- keep the server/web release independently deployable and tied to an exact green SHA;
- keep web/PWA support while the iOS client matures;
- use a narrow native bridge for contacts, local authentication, privacy shielding and native media/file pickers;
- do not give native code a plaintext-upload bypass around the existing encrypted attachment pipeline;
- do not expose arbitrary filesystem or arbitrary native execution to WebView JavaScript;
- only approved production origins may load in the native web view;
- record the exact source SHA, iOS version/build number and archive/TestFlight evidence for each mobile release;
- TestFlight is a validation stage, not the final production distribution target;
- App Store submission requires Step88 and Step70 acceptance plus an explicit release decision.

The iOS product remains named **Sudoku** and must preserve the normal playable Sudoku launch surface and privacy concealment behavior.

## DNS

Production DNS is managed outside the repository.

Required records:

| Name | Type | Target |
| --- | --- | --- |
| `sudoku.moscow` / apex | A | `185.31.167.36` |
| `assets.sudoku.moscow` | A | `185.31.167.36` |

Current DNS delegation uses REG.RU nameservers. Only create AAAA records when the host has confirmed working public IPv6.

Caddy obtains and renews certificates after DNS is correct and ports 80/443 are reachable.

## Network boundary

Selectel security group is the outer firewall.

Ingress policy:

- TCP 22: administrator source IP/range only;
- TCP 80: Internet;
- TCP 443: Internet;
- no public PostgreSQL, Redis, MinIO, API, Web or Docker daemon ports.

Outbound traffic is allowed as required for package/image pulls, ACME/TLS and the configured Web Push providers.

From the administrator source, the verified external exposure was:

- 22 open;
- 80 open;
- 443 open;
- 3000 closed;
- 5432 closed;
- 6379 closed;
- 8000 closed;
- 9000 closed;
- 9001 closed.

A changed administrator public IP can make SSH time out even while the server is healthy. Update only the TCP/22 source allowlist; never expose SSH as `0.0.0.0/0`.

## SSH hardening

Routine administration uses the unprivileged `deploy` account and public-key authentication.

Verified SSH policy:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
```

Do not store private SSH keys in this repository.

Example administrator connection:

```bash
ssh -i ~/.ssh/sudoku_selectel deploy@185.31.167.36
```

The local key path is only an example workstation convention. The key itself is never committed.

## Runtime topology

Production runs the following Docker services:

- Caddy — only host-published application service, TCP 80/443;
- Web — Next.js, internal TCP 3000;
- API — FastAPI, internal TCP 8000;
- PostgreSQL — internal TCP 5432;
- Redis — internal TCP 6379;
- MinIO — internal TCP 9000;
- MinIO initialization job;
- Celery worker;
- Celery beat.

The production override removes direct MinIO publication. Browser object access is through `https://assets.sudoku.moscow`.

Relevant tracked configuration:

- `compose.yaml`;
- `compose.production.yaml`;
- `infra/caddy/Caddyfile.production`;
- `.env.production.example`.

## Caddy / TLS boundary

`infra/caddy/Caddyfile.production` is the tracked source of truth.

Application host:

- HTTPS/TLS managed by Caddy;
- `/v1/*` -> API;
- all other paths -> Web;
- HSTS;
- CSP;
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- restrictive Permissions Policy;
- same-origin WebSocket path.

Asset host:

- HTTPS/TLS managed by Caddy;
- reverse proxies to private MinIO;
- object-store security headers;
- no direct public MinIO port.

## Production environment

Create the live file from `.env.production.example` and keep it only on the server:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Required values include:

- `APP_DOMAIN`;
- PostgreSQL secret;
- MinIO root credentials;
- dedicated least-privilege S3 application credentials;
- stable VAPID public/private key pair;
- `VAPID_SUBJECT`;
- `REQUIRE_E2EE_NEW_CONVERSATIONS=true`.

All production secrets must be independent random values where applicable.

### Never commit

Do not put any of the following in Git, issues, PR descriptions or documentation:

- `.env.production`;
- PostgreSQL passwords;
- MinIO root password;
- S3 secret access key;
- VAPID private key;
- SSH private keys;
- session cookies/tokens;
- invite codes;
- backup archives containing production data;
- administrator source IP allowlist unless there is an explicit operational reason to publish it;
- decrypted private message/attachment content.

The committed `.env.production.example` contains placeholders only.

## Standard deployment

Deploy an exact SHA that has passed the full CI pipeline. The generic command below is not a complete PIN rollout: first satisfy the consistent-backup, migration-order, rollback and authorization prerequisites in Release status and Step79. Do not execute it merely because a merge succeeded.

From an administrator workstation:

```bash
ssh -t -i ~/.ssh/sudoku_selectel deploy@185.31.167.36 '
set -euo pipefail
cd ~/sudoku

git fetch origin
git checkout <verified-production-sha>

ENV_FILE=.env.production bash scripts/preflight-production.sh

docker compose \
  --env-file .env.production \
  -f compose.yaml \
  -f compose.production.yaml \
  up -d --build --remove-orphans

docker compose \
  --env-file .env.production \
  -f compose.yaml \
  -f compose.production.yaml \
  ps

APP_DOMAIN=sudoku.moscow bash scripts/smoke-production.sh
'
```

Deployment is not considered successful until the final live smoke passes.

## Preflight gate

Run before every production start/update:

```bash
ENV_FILE=.env.production bash scripts/preflight-production.sh
```

The preflight is expected to fail closed on, among other things:

- missing/placeholder production values;
- unsafe env-file permissions;
- invalid VAPID key shape;
- disabled production E2EE requirement;
- DNS problems;
- unsupported Compose behavior;
- unexpected host-published ports.

Do not bypass this check to force a release through.

## Live smoke

Run after every deploy:

```bash
APP_DOMAIN=sudoku.moscow bash scripts/smoke-production.sh
```

It verifies the live edge, including:

- DNS;
- certificate-valid HTTPS;
- API readiness;
- security headers/CSP;
- asset hostname TLS;
- HTTP -> HTTPS redirects.

Also verify the public port boundary from an external machine.

## Rollback

Rollback means redeploying a previously verified application SHA, not restoring arbitrary old container state. The PIN release additionally requires the session-safety boundary in Release status: a previously verified pre-PIN SHA is not a safe rollback for active PIN-enabled sessions.

1. Identify the last known-good SHA.
2. Check whether any database migration introduced by the failed release is backward-compatible.
3. Never automatically downgrade the production database.
4. Checkout the known-good SHA.
5. Run preflight.
6. Rebuild/restart with the same production env.
7. Run the live smoke.

Example:

```bash
git fetch origin
git checkout <last-known-good-sha>
ENV_FILE=.env.production bash scripts/preflight-production.sh
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --build --remove-orphans
APP_DOMAIN=sudoku.moscow bash scripts/smoke-production.sh
```

If rollback requires data restoration, use the backup/restore procedure instead of improvising a schema downgrade.

## Backup and restore

Backups are an operational requirement before admitting real user data.

Create a backup:

```bash
bash scripts/backup-production.sh
```

Restore is intentionally destructive:

```bash
RESTORE_CONFIRM=YES bash scripts/restore-production.sh ./backups/<timestamp>
```

After restore:

1. verify checksum/manifest validation;
2. run the live smoke;
3. verify the baseline account/conversation;
4. verify an encrypted attachment can still be retrieved and decrypted by the authorized client.

Never commit backup output.

## First administrator

Bootstrap only on an empty users table:

```bash
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml \
  exec api python -m app.cli bootstrap-admin --phone '<e164-phone>' --display-name '<display-name>'
```

The password is entered through the hidden prompt. Never pass it in argv or paste it into documentation.

## Production verification state

Repository CI is not the final production gate.

Step 70 remains open until all of these have passed on the live release:

- latest merged SHA deployed and live smoke passed;
- persistence across stack restart and host reboot;
- destructive PostgreSQL + encrypted-object restore drill;
- second-account invite acceptance;
- two-device MLS send/receive and recovery;
- encrypted attachment/voice flow;
- remote session revocation;
- installed iOS PWA smoke;
- installed Android PWA smoke.

The authoritative checklist and evidence log is `docs/steps/70-live-verification.md`.

## Operational references

- `docs/PROGRESS.md` — current project/release status;
- `docs/steps/70-live-verification.md` — live verification checklist and evidence log;
- `docs/SECURITY.md` — application/security boundary;
- `compose.production.yaml` — production container overrides;
- `infra/caddy/Caddyfile.production` — edge/TLS configuration;
- `.env.production.example` — non-secret environment schema;
- `scripts/preflight-production.sh` — pre-deploy safety gate;
- `scripts/smoke-production.sh` — live edge smoke;
- `scripts/backup-production.sh` / `scripts/restore-production.sh` — backup and recovery.

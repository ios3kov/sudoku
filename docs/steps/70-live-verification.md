# Step 70 — Live production verification

## Goal
Close the only remaining production gate on a real Selectel host and physical iOS/Android devices. Repository CI is necessary but cannot substitute for this step.

The canonical non-secret host/DNS/deployment inventory is maintained in `docs/PRODUCTION.md`.

## Pass criteria
Step 70 passes only when all checks below are verified against the same production commit:
- public DNS and valid TLS for the app and encrypted-object host;
- external network exposure limited to the intended ports;
- production CSP/security headers are present;
- PostgreSQL, Redis and MinIO survive service/host restart as expected;
- a real PostgreSQL + encrypted-object destructive restore drill succeeds before real user data is admitted;
- first administrator bootstrap succeeds without exposing the password in argv/history;
- two-device MLS messaging, attachment/voice encryption, reload/offline recovery and remote session revocation pass;
- installed iOS and Android PWAs pass background/privacy, push and microphone/attachment smoke tests.

## 1. Provision Selectel host
Current host: Selectel `sudoku-prod`, Moscow `ru-7a`, public IPv4 `185.31.167.36`.

Baseline for the invite-only MVP: Ubuntu 24.04 LTS, 2 vCPU, 4 GB RAM, 50 GB disk.

Use an SSH key. Do not enable password SSH login for routine administration.

Selectel security-group ingress:
- TCP 22 only from the administrator source IP/range;
- TCP 80 from the Internet;
- TCP 443 from the Internet;
- no PostgreSQL, Redis, MinIO, API, Web or Docker daemon ports.

Use Selectel security groups as the outer network boundary. Docker-published ports can bypass host UFW/firewalld policy, so the Compose published-port boundary remains mandatory too.

Install Docker Engine from Docker's official Ubuntu apt repository, including the Compose plugin. Docker Compose must be >= 2.24.4 because production overrides use `!reset` / `!override` merge tags.

References:
- https://docs.selectel.ru/en/cloud-servers/create/create-server/
- https://docs.selectel.ru/cloud-servers/security-groups/manage-groups/create-group/
- https://docs.docker.com/engine/install/ubuntu/
- https://docs.docker.com/reference/compose-file/merge/

## 2. DNS
Create records pointing to the Selectel public address:
- `APP_DOMAIN`;
- `assets.APP_DOMAIN`.

Create AAAA records only when the server has working public IPv6. Caddy obtains and renews TLS certificates after DNS is live and ports 80/443 are reachable.

## 3. Checkout the verified commit
Deploy the exact commit that passed full CI, not an unverified moving branch head.

```bash
git clone https://github.com/ios3kov/sudoku.git
cd sudoku
git checkout <verified-production-sha>
```

## 4. Production environment

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Generate URL-safe secrets. In particular `POSTGRES_PASSWORD` is embedded into `DATABASE_URL`, so use unreserved characters such as hex:

```bash
openssl rand -hex 32
```

Use independent random values for PostgreSQL, MinIO root and the dedicated MinIO application user. The application access key must not reuse the MinIO root username.

Generate one VAPID pair on a trusted admin machine and keep it stable for this deployment:

```bash
npx --yes web-push generate-vapid-keys --json
```

Copy `publicKey` -> `VAPID_PUBLIC_KEY` and `privateKey` -> `VAPID_PRIVATE_KEY`. Set a real `VAPID_SUBJECT` such as an operations `mailto:` address.

Before starting containers:

```bash
ENV_FILE=.env.production bash scripts/preflight-production.sh
```

The preflight must reject placeholders, weak/unsafe deployment secrets, invalid VAPID key shape, unresolved DNS, unsupported Compose versions, unexpected Compose publication and any host-published service ports except Caddy 80/443.

## 5. Deploy and edge smoke

```bash
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml up -d --build --remove-orphans
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml ps
APP_DOMAIN=<host> bash scripts/smoke-production.sh
```

The smoke gate verifies DNS, certificate-valid HTTPS, application readiness, HTTP -> HTTPS redirects, the asset-host TLS edge and required security headers.

From an external administrator machine, also scan the public address. From the allowed SSH source, only 22/80/443 should be reachable; from any other source, only 80/443 should be reachable. Investigate any additional open port before continuing.

## 6. Bootstrap the first administrator
Run inside the API container so the password is read from a hidden prompt rather than argv:

```bash
docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml \
  exec api python -m app.cli bootstrap-admin --email '<admin-email>' --display-name '<display-name>'
```

Do this only once on the empty production users table.

## 7. Persistence smoke
Before inviting real users:
1. Create the admin session and a test invite/device.
2. Send an encrypted text message plus one encrypted attachment.
3. Restart the application stack, then reboot the host once.
4. Verify authentication policy, encrypted history, MinIO object access and realtime recovery after restart/reboot.
5. Confirm PostgreSQL, Redis and MinIO volumes are still mounted and healthy.

## 8. Real backup/restore drill
Do this before admitting real user data. The restore script is intentionally destructive: it drops/recreates the application database and clears/rebuilds the object bucket.

1. Keep the baseline test conversation/attachment from the persistence smoke.
2. Take a backup:

```bash
bash scripts/backup-production.sh
```

3. Run a destructive restore of that exact backup:

```bash
RESTORE_CONFIRM=YES bash scripts/restore-production.sh ./backups/<timestamp>
```

4. Re-run the edge smoke:

```bash
APP_DOMAIN=<host> bash scripts/smoke-production.sh
```

5. Verify the baseline account/conversation and encrypted attachment still exist and open correctly after the database and bucket were rebuilt.
6. Verify the backup `SHA256SUMS` check passed and record the backup timestamp plus manifest/checksum result. Never record secret values or decrypted private content.

## 9. Two-device encrypted smoke
On two independent physical devices/accounts:
- compare the displayed safety number over a separate channel;
- direct encrypted send/receive both directions;
- group add/remove and post-transition send;
- image/file/voice upload, local decrypt and playback/open;
- offline send then reconnect: exactly one visible result;
- reload/reopen: history recovers from durable transport without duplicate Welcome/application events;
- revoke one device session remotely: the revoked device must immediately conceal the messenger, stop reconnecting and require a fresh session/device bootstrap.

No plaintext fallback is acceptable.

## 10. Installed PWA — iOS and Android
Run the same checklist on an installed PWA on each platform:
- install/add to home screen and relaunch;
- hidden Sudoku gesture still works;
- background/app-switch privacy cover works immediately;
- after >30 seconds in background, returning shows Sudoku before private content;
- generic Sudoku-only push is delivered while the user is offline/backgrounded;
- push contains no sender/message/attachment metadata;
- microphone permission plus encrypted voice record/send/playback;
- encrypted image/file send/open;
- safe-area, keyboard, scrolling, composer and attachment controls have no clipping/overflow.

## Evidence and stop rule
Record in this document after execution:
- deployed Git SHA;
- verification date;
- app/asset hostnames;
- Selectel region/server class (never credentials/private keys);
- external port-scan result;
- backup manifest/checksum result;
- iOS/Android OS/browser/PWA versions used;
- pass/fail for every item above.

Do not mark production verified until every Step 70 item passes. Any failure reopens the relevant gate and must be fixed, reviewed and re-tested before launch.


## Execution log — 2026-09-20

Live preparation completed:
- Selectel production host provisioned and hardened;
- production DNS for `sudoku.moscow` and `assets.sudoku.moscow` resolves to the Selectel host;
- production secrets/VAPID created on-host with restrictive env-file permissions;
- `scripts/preflight-production.sh` passed against the live production configuration.

First production deploy on commit `cdbdcde4` exposed a Web Docker build regression: `@sudoku/domain` was copied into the image but its `dist` output was not built before Next.js compilation, so the container build failed closed with module-resolution errors.

The failure did not start the production application stack. PR #22 fixed the missing domain-workspace build and passed the full CI/production-image gate.

Second production deploy:
- verified commit: `68211e02`;
- application stack started successfully;
- live edge smoke passed for `sudoku.moscow`;
- external administrator-source scan: 22/80/443 reachable; 3000/5432/6379/8000/9000/9001 closed;
- first administrator bootstrap succeeded through the hidden password prompt.

Device testing then identified Sudoku-shell UX corrections before continuing the two-device gate:
- private unlock must begin by pressing digit 5 in the keypad and swiping upward without releasing; the **whole Sudoku screen** must track the finger upward, revealing the actual private surface underneath, then either complete offscreen or spring back;
- mobile keypad must keep all digits 1–9 on one row at board width;
- fixed `Level 1` copy must be replaced by a stable puzzle number;
- add visible Sudoku branding and compact timer/mistakes/progress HUD.

Two-device invite acceptance has not yet passed and remains open. Do not continue to persistence/restore completion claims until the current UX patch is deployed and the invite flow is verified.


### Follow-up interaction correction
The moving-digit/progress-rail implementation was rejected during live UX review because it did not match the intended iPhone-style unlock metaphor.

The replacement implementation is tracked in the Sudoku unlock audit:
- `docs/audits/sudoku-unlock-ux-2026-09-20.md`;
- drag path uses compositor transform updates via `requestAnimationFrame`, not React state per pointer move;
- private underlay is lazy-mounted only after real drag movement;
- privacy/background concealment explicitly covers a partial reveal.


## Execution log — 2026-09-21

Release and device-test update:
- PR #25 passed full CI #245 and was squash-merged as `6c0aefe95d02c3ee430904d3449ad6c8070cdf8b`;
- the full-screen Sudoku reveal is now observable on the live device path, confirming the intended whole-screen interaction reached production testing;
- live device testing found two follow-up issues: the release/return animation does not yet have iPhone-like smoothness, and normal Sudoku digit entry became too restrictive/appeared non-functional;
- the follow-up implementation keeps the private surface pre-mounted and inert below Sudoku so the drag path does not trigger a heavy React mount, drives the screen and underlay with compositor transforms, adds underlay parallax/scale plus spring-like settle, and restores unrestricted 1–9 entry for editable cells while marking invalid entries visually;
- ordinary tap on digit 5 remains a normal Sudoku input; only an upward hold-and-drag activates the hidden reveal;
- automated acceptance is extended to verify all 1–9 keypad digits, erase/notes/reset, immutable givens, incomplete-drag return, full-screen reveal and privacy behavior.

Do not mark this follow-up live-verified until its CI passes, it is merged/deployed as an exact SHA, and the physical-device animation/gameplay retest passes.


### Live interaction follow-up — grid + unlock threshold

Physical iPhone testing after PR #26 identified:
- invalid Sudoku cells could distort the board because the Sudoku `error` class collided with the global form-error CSS selector;
- the reveal threshold still accepted a short swipe.

Current correction:
- Sudoku invalid cells use a dedicated `invalid` class with no layout-changing margin/padding/radius;
- automated UI acceptance verifies invalid-cell geometry and board dimensions after a wrong entry;
- the gesture uses the available vertical path from digit `5` to the top edge as 100% progress;
- below 50%, release returns the whole Sudoku surface;
- at 50%, the finishing animation takes over and completes the remaining 50%;
- a normal tap on digit `5` still behaves as normal Sudoku input.

This follow-up must pass CI, exact-SHA deploy/smoke and physical-device retest before the interaction gate can close.


### Live interaction follow-up — 50% handoff + fixed chat scale

Latest iPhone feedback:
- the unlock should hand off earlier: at 50% of the available upward path, not 75%;
- focusing login/chat text fields must not zoom or rescale the whole messenger UI.

Current correction:
- below 50%, release returns the Sudoku surface;
- at 50%, the finishing animation takes over and completes the remaining half;
- mobile viewport is fixed at scale 1;
- browser zoom is disabled for this installed/private UI;
- all text inputs/areas use at least 16px font size to prevent iOS focus auto-zoom;
- browser acceptance checks viewport metadata and auth-input font size.

Physical iPhone retest must confirm the messenger visual scale remains unchanged while entering email/password and later while typing messages.

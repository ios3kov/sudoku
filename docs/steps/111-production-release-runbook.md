# Step 111 — production release runbook

Date: 2026-09-25.

## Release candidate

Verified executable candidate:

`effa0e03349d7ec04f88350b166bffec7e65aad8`

Exact-candidate verification:
- `ci #720` / 36175072493 — success;
- `device-access #403` / 36175072562 — success;
- `beat-runtime #405` / 36175072546 — success;
- `api-shutdown #387` / 36175072498 — success.

The CI restore artifact `restore-audit-36175072493-1` confirms synthetic post-restore phone login, E2EE conversation/message recovery and signed encrypted-asset download with matching ciphertext SHA-256.

This runbook does **not** authorize deployment. Production rollout still requires explicit operator authorization.

## Hard release gates before deploy

Do not continue to rollout until both are recorded as PASS:

1. **Physical iPhone / two-account acceptance**
   - phone/password login;
   - four-digit PIN unlock and reload;
   - hidden reveal gesture and immediate concealment;
   - direct + group E2EE messaging;
   - reconnect/offline recovery and no duplicate retry;
   - photo/video/voice/file send + playback/download;
   - background/app-switcher privacy;
   - VoiceOver/basic media quality.

2. **Latest real production backup restore acceptance**
   - create a fresh consistent backup from the currently deployed checkout;
   - verify `SHA256SUMS`;
   - verify `pg_restore -l` can read the dump;
   - copy the fresh backup to encrypted off-host storage and verify checksums there;
   - restore that backup into an isolated production-like environment and record database/object/application acceptance.
   - Never test restore destructively against the live production stack before release.

## 1. Fresh backup on the CURRENT production checkout

Important: backup happens **before** checking out the release candidate. This avoids applying new Compose configuration while producing the rollback backup.

```bash
set -euo pipefail
cd /home/deploy/sudoku

PREVIOUS_SHA="$(git rev-parse HEAD)"
printf 'previous_sha=%s\n' "$PREVIOUS_SHA"
git status --short

BACKUP_ROOT="$HOME/sudoku-safe-backups" \
ENV_FILE=.env.production \
bash scripts/backup-production.sh
```

Capture the printed backup directory as `BACKUP`.

Verify it locally on the server:

```bash
test -n "$BACKUP"
test -s "$BACKUP/postgres.dump"
test -s "$BACKUP/SHA256SUMS"
test -f "$BACKUP/manifest.txt"
test -d "$BACKUP/objects"

(
  cd "$BACKUP"
  sha256sum -c SHA256SUMS
)

docker compose --env-file .env.production \
  -f compose.yaml -f compose.production.yaml \
  exec -T postgres pg_restore -l < "$BACKUP/postgres.dump" >/dev/null
```

Copy the entire backup directory to encrypted off-host storage and verify the same `SHA256SUMS` there before rollout.

## 2. Checkout the exact verified candidate

```bash
set -euo pipefail
cd /home/deploy/sudoku

RELEASE_SHA=effa0e03349d7ec04f88350b166bffec7e65aad8

git fetch origin --prune
git checkout --detach "$RELEASE_SHA"

test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git status --porcelain)"
```

## 3. Production preflight

The release preflight now refuses an unexpected SHA or dirty tracked tree.

```bash
EXPECTED_GIT_SHA="$RELEASE_SHA" \
ENV_FILE=.env.production \
bash scripts/preflight-production.sh
```

Required output:

```text
[preflight] production configuration passed
```

Stop immediately on any other result.

## 4. Build and rollout

This is the proven Compose release pattern used by prior Sudoku production releases.

```bash
dc=(
  docker compose
  --env-file .env.production
  -f compose.yaml
  -f compose.production.yaml
)

"${dc[@]}" build
"${dc[@]}" up -d --remove-orphans
"${dc[@]}" ps -a
```

Do not treat a successful `up -d` as release success; continue to verification.

## 5. Live verification

Allow services to reach healthy state, then run the hardened live smoke.

```bash
sleep 20

"${dc[@]}" ps -a

APP_DOMAIN=sudoku.moscow \
bash scripts/smoke-production.sh
```

The smoke verifies HTTPS/readiness plus the deployed nonce-CSP contract, including:
- fresh nonce across two document responses;
- nonce-bound `script-src`;
- `strict-dynamic`;
- `wasm-unsafe-eval`;
- absence of script `unsafe-inline`;
- asset endpoint;
- secure WebSocket origin;
- HTTPS redirects;
- security headers.

Also inspect application workers:

```bash
"${dc[@]}" logs --no-color --since=2m api worker beat | tail -200
```

No traceback, permission error, crash loop or repeated restart is accepted.

## 6. Minimal post-release functional acceptance

After smoke:
- admin phone login;
- PIN unlock;
- reload returns to secure messaging;
- one real direct E2EE message between the two test accounts;
- one encrypted attachment upload/download;
- reconnect after temporary offline;
- iPhone background/foreground concealment.

Record the deployed SHA:

```bash
git rev-parse HEAD
```

Expected:

```text
effa0e03349d7ec04f88350b166bffec7e65aad8
```

## Failure / rollback boundary

If preflight fails: do not deploy.

If build fails before `up -d`: production remains on the previous containers; do not continue.

If rollout or smoke fails:
1. stop the public edge if private data or application integrity is uncertain:
   ```bash
   "${dc[@]}" stop caddy
   ```
2. retain logs and container state;
3. do **not** blindly check out the previous application after database migrations;
4. use `PREVIOUS_SHA` plus the fresh verified backup as the rollback evidence and choose the rollback path only after checking migration compatibility;
5. if database/object consistency is in doubt, keep the public edge stopped and restore the fresh backup before reopening traffic.

A release is complete only after live smoke and the minimal post-release functional acceptance both pass.

# Step 108 — exact-SHA preflight and nonce-CSP live smoke

Date: 2026-09-25.

## Goal

Tighten the final production release gate without deploying anything.

## Preflight

`scripts/preflight-production.sh` now requires `EXPECTED_GIT_SHA` to be the exact 40-character commit intended for release. Preflight rejects:

- a checkout whose `HEAD` differs from the declared release SHA;
- staged or unstaged tracked changes;
- the existing invalid secret/configuration cases.

Untracked operator files such as the production environment file do not make the repository dirty.

CI exercises the correct-SHA path plus explicit wrong-SHA and dirty-tree rejection.

## Live smoke

`scripts/smoke-production.sh` now fetches the application document twice and verifies the deployed nonce-CSP contract at the public edge:

- `Content-Security-Policy` and `x-nonce` are present;
- the nonce rotates between document responses;
- each `script-src` contains its matching nonce;
- `script-src` includes `strict-dynamic` and `wasm-unsafe-eval`;
- `script-src` does not allow `unsafe-inline`;
- asset and secure WebSocket origins remain present.

The existing HSTS, frame, referrer, COOP/CORP, permissions, asset TLS, readiness and HTTP-to-HTTPS redirect checks remain.

Fake-edge unit tests cover success, nonce reuse rejection and script `unsafe-inline` rejection without touching real services.

## Release boundary

This step does not deploy production, run migrations, restart services or perform the production-aligned restore drill. Production release still requires a fresh backup, the exact release SHA, restore evidence, physical/device acceptance and explicit operator deployment authorization.

# Step 106 — parallel CI and explicit nonce-CSP regression

Date: 2026-09-25.

## Scope

This step closes two verification gaps without changing production deployment state:

1. shorten release CI wall-clock time by running independent verification work in parallel;
2. replace indirect CSP confidence with explicit scanner and browser runtime regression coverage.

## Parallel CI

PR #93 merged to main as `ac145152a8a06f90031eb75d074b3df3e34667e1`.

The former serial `ci / test` workflow was split into independent shards:

- API + security;
- OpenMLS + Rust;
- Web build + static regressions;
- Browser E2E;
- Infra + restore + production images.

OpenMLS browser output is built once and passed to the dependent Web/Browser jobs as a short-lived artifact. The final job remains named `test` and fails unless every shard succeeds, preserving the existing release-gate surface while reducing unnecessary serialization.

## CSP regression

PR #95 merged to main as `8fead74e3a3ac95487b7a6d29f25f057591805a9`.

The current document CSP is owned by Next.js `apps/web/proxy.ts`, not by a static Caddy policy. Each matched document response receives a fresh nonce. The script policy requires the nonce and includes `strict-dynamic` and `wasm-unsafe-eval`; generic script `unsafe-inline` is absent. Caddy forwards this dynamic header.

New Browser E2E coverage verifies:

- a CSP header exists on document responses;
- the response nonce exists and rotates between requests;
- the CSP nonce matches the response `x-nonce`;
- Next-generated script elements carry the same nonce;
- `script-src` contains `strict-dynamic` and `wasm-unsafe-eval`;
- `script-src` does not contain `unsafe-inline`;
- a parser-inserted inline script without a nonce is blocked.

The deterministic repository scanner was also corrected so a comment mentioning `Content-Security-Policy` in Caddy cannot satisfy the production-header invariant. Scanner unit tests cover the false-positive case and the valid dynamic-Next-CSP case.

`style-src 'unsafe-inline'` remains an explicit compatibility exception and is not treated as script permission.

## Verification

PR #95 head `8668a9b3e86dc77ba21fe4d36077db4ed82f8a09` passed all applicable PR workflows including the parallel CI and Browser E2E.

Post-merge exact-main verification on `8fead74e3a3ac95487b7a6d29f25f057591805a9`:

- `ci` run 36163328436 — success;
- `device-access` run 36163328513 — success;
- `beat-runtime` run 36163328457 — success;
- `api-shutdown` run 36163328630 — success.

## Release boundary

This step does not authorize or perform production deployment, migration, restart, TestFlight or App Store publication.

Remaining release gates:

- physical iPhone/two-account acceptance;
- VoiceOver, native media and audiovisual-quality acceptance;
- representative real-device performance/thermal/energy profiling;
- production-aligned isolated restore drill with application-level login/message/media verification;
- deployment preflight with a fresh verified backup and rollback plan;
- separate explicit production deployment authorization.

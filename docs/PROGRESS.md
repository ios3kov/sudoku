# Progress

## Current milestone
Full restored MVP acceptance and hardening.

## Repository truth

### Steps 17–20
Direct-source recovery, Sudoku/auth shell, PostgreSQL auth/session migration and rate limiting are restored and service-backed verified.

### Step 21 — Full source import
Complete MVP source is present as ordinary files: API, web messenger, realtime, assets/push, groups/devices, search/preferences, infrastructure, observability and integration tests.

### Step 22 — CI packaging + S3 hardening
API package discovery fixed; S3 integration moved to an in-process test server. Acceptance now reaches real API integration tests.

### Step 23 — Valid integration identities
Acceptance exposed a test-fixture defect: reserved `.test` email domains are correctly rejected by production `EmailStr` validation. Production validation remains unchanged; randomized `example.com` identities are used in integration tests.

## Verification
- Step 20 service-backed gate: fully green.
- Full-tree packaging/S3 stages: now pass.
- Latest acceptance reached API integration and failed only at invalid test email fixture before the rest of the scenario.
- Step 23 acceptance pending.

## Next step
Continue acceptance until API integration, domain, web typecheck and production build are all green; then perform code/security review.

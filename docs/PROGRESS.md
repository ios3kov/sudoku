# Progress

## Current milestone
Full restored MVP acceptance and hardening.

## Repository truth

### Steps 17–20
Direct-source recovery, Sudoku/auth shell, PostgreSQL auth/session migration and rate limiting are restored. Step 20 service-backed CI is green.

### Step 21 — Full source import
Complete locally verified MVP source is now present as ordinary files: API, web messenger, realtime, assets/push, groups/devices, search/preferences, infrastructure, observability and integration tests.

### Step 22 — CI packaging + S3 hardening
First full-tree acceptance failed at API editable installation because setuptools auto-discovered `app` and `alembic`. Package discovery is explicit now. S3 integration was also moved to an in-process test server to remove external image availability from the CI critical path.

## Verification
- Step 20: PostgreSQL migration/schema assertion ✓ auth/session integration ✓ domain ✓ web typecheck/build ✓.
- Full-tree run `35465183161`: failed at API package installation; later stages skipped.
- Corrected full-tree acceptance CI pending on current `main`.

## Next step
Drive the complete acceptance pipeline to green, then perform code/security review and production deployment preparation.

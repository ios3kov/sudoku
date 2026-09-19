# Step 22 — CI packaging + S3 test hardening

## Goal
Make the complete restored MVP installable and testable in the acceptance pipeline.

## Findings
The first full-tree acceptance run failed before application tests. Editable installation of `apps/api` let setuptools auto-discover both `app` and `alembic` as top-level packages.

The initial external MinIO-image approach also added avoidable registry/image availability to the acceptance path.

## Fixes
- API package discovery is explicitly constrained to the application package.
- S3 integration now uses an in-process test server in CI, reducing external image/registry failure modes.
- No product test is counted as passed from the failed full-tree run because later stages were skipped.

## Verification
The next acceptance run must complete API install, S3 startup, migrations, API integration tests, domain tests, web typecheck and Next production build.

## Next
Drive acceptance to green; then perform code/security review against the documented MVP.

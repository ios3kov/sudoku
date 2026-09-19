# Step 35 — E2EE server boundary

## Goal
Make the API capable of ciphertext-only conversations before client cryptography is introduced.

## Implemented
Migration 0006, E2EE conversation policy, ciphertext envelope, public device key registry and negative plaintext/search invariants.

## CI findings
The first generated patch inserted literal backslash-n sequences into multiple Python files. The original workflow had no syntax compilation stage, so the first failure appeared while Alembic imported models. After adding `compileall`, the guardrail correctly identified all remaining affected files: models, main, schemas and messaging.

## Fix
All literal generated newline escapes in the affected Python source are replaced with real newlines. CI now compiles `app` and `alembic` before database migration.

## Required verification
1. compileall passes;
2. migration 0006 passes on clean PostgreSQL;
3. plaintext E2EE send is rejected;
4. ciphertext envelope persists with null body_text;
5. server search is disabled for E2EE;
6. legacy MVP/domain/web/production-compose gates remain green.

## Next
Only after these gates pass: Step 36 atomic one-time-prekey consumption.

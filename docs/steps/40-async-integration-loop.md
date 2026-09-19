# Step 40 — Stable async integration event loop

## Finding
The first real post-provisioning CI run passed source compilation and Alembic migrations 0006–0008, then failed in API integration tests with asyncpg/SQLAlchemy reporting a Future attached to a different event loop.

The shared SQLAlchemy async engine/pool outlived the function-scoped pytest-asyncio loop created for the previous test.

## Fix
All integration tests in `test_mvp_flow.py` now use `@pytest.mark.asyncio(loop_scope="session")`, keeping the shared async database engine and its pooled connections on one event loop for the test module/session.

## Verification required
- compileall;
- migrations 0001–0008;
- legacy MVP integration flow;
- ciphertext-only E2EE test;
- MLS KeyPackage single-use/replay test;
- web typecheck/build;
- production compose validation.

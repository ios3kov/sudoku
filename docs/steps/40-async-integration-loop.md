# Step 40 — Stable async integration event loop

## Findings
1. Shared asyncpg/Redis clients were reused across function-scoped pytest event loops, producing cross-loop failures.
2. After switching the integration suite to a session-scoped asyncio loop, the loop failure disappeared.
3. The remaining E2EE test failure was a test-fixture error: it attempted to create an empty group, while the API correctly requires another member.

## Fixes
- All async integration tests use `loop_scope="session"`.
- The ciphertext-only E2EE test now creates two users and a real two-party encrypted direct conversation, matching the MLS design where direct chat is a two-member group.

## Verification required
- compileall;
- migrations 0001–0008;
- legacy MVP integration;
- ciphertext-only E2EE integration;
- MLS KeyPackage single-use/replay integration;
- web typecheck/build;
- production compose validation.

# Step 72 — Behavior-preserving structural refactor

## Goal
Reduce concentration in the largest files without changing product behavior, API contracts, MLS ordering, persistence semantics or deployment topology.

## Changes
- `openmls-adapter.ts`: durable local-state/codec logic moved to `openmls-state.ts`; application event validation/conversion moved to `openmls-events.ts`. Adapter remains responsible for MLS orchestration, epochs, transport and persistence ordering.
- `apps/api/app/e2ee.py`: request contracts, base64 validation, active-device authorization and common serializers moved to `e2ee_support.py`. Route transactions/locks stay in place.
- `apps/api/app/routes/messaging.py`: message/conversation serialization, membership checks and outbox helper moved to `messaging_support.py`. Endpoint mutation ordering is unchanged.
- Added `chat-utils.ts` for shared conversation title, voice MIME policy and common formatters. Encrypted chat no longer imports the ordinary conversation component for a helper.
- Replaced monolithic `test_mvp_flow.py` with `test_core_flow.py`, `test_mls_transport.py` and `test_mls_membership.py`. The same 11 integration scenarios remain.

## Size change
- `openmls-adapter.ts`: ~64.7 KB -> ~53.7 KB.
- `e2ee.py`: ~61.7 KB -> ~54.5 KB.
- `routes/messaging.py`: ~36.9 KB -> ~31.5 KB.
- API integration tests: ~66 KB monolith -> 26.4 KB / 22.2 KB / 18.1 KB domain files.

## Deliberately not changed
Deeper splitting of `messenger-shell.tsx`, MLS membership/transport orchestration and transaction-sensitive route handlers was intentionally deferred. Those areas encode lifecycle/crash-safety ordering, and before first live deployment the regression risk is greater than the maintenance benefit.

## Verification
Code gate: `b84fc7ef`.

Full enhanced CI passed:
- Python compile/migrations, Ruff, pip-audit and 11 API integration tests ✓
- OpenMLS Rust tests, WASM build and RustSec ✓
- canonical npm install/audit, UI contract and ESLint ✓
- domain/performance tests and TypeScript ✓
- Next production build + bundle/WASM budget ✓
- production-mode Chromium E2E ✓
- backup/restore script + production Compose validation ✓
- real API/Web Docker image builds + non-root assertions ✓

## Stop result
Behavior-preserving refactor stop criteria are met: no intended behavior/API/MLS lifecycle change, high-value pure/support boundaries extracted, and the full production gate remains green.

Next required stage remains Step 70: live infrastructure plus physical iOS/Android verification.

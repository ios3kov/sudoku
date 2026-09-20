# Step 69 — Final verification and production gate

## Review performed
The final code review checks:
- no plaintext fallback for `encryption_required` conversations;
- production API requires E2EE for newly created conversations;
- encrypted attachments never render the server ciphertext URL directly;
- application sends are blocked on stale/failed MLS synchronization;
- device add/revoke changes rotate MLS membership before new traffic;
- activation requires Welcome coverage for all active participant devices;
- session, Origin, WebSocket, asset authorization and rate-limit boundaries remain enabled;
- production Compose rejects unpinned `:latest` images and local-origin leakage.

## Automated acceptance
The full pipeline covers:
- Python compile + Alembic migration;
- API integration tests with PostgreSQL/Redis/S3-compatible storage;
- pinned OpenMLS Rust tests + WASM build;
- domain tests and declarations;
- web typecheck + production build;
- Chromium E2EE reload/offline/fail-closed acceptance;
- merged production Compose policy checks.

## Current CI note
The most recent browser failure before this step occurred in the test-only hidden Sudoku unlock helper: OS-level mouse hit-testing did not reliably deliver the final pointer event in headless Chromium. The helper now dispatches the exact pointerdown/pointerup pair handled by the application gesture state machine.

This does not weaken or bypass the production UI; it makes the acceptance test deterministic.

## External production checks still required
Automated CI cannot substitute for:
- installed iOS/Android PWA background/privacy-cover behavior;
- real push delivery on Apple/Google devices;
- microphone permission + encrypted voice-note playback on physical devices;
- live DNS/TLS, object storage, database/Redis persistence and backup restore;
- final smoke test on the deployed hostname.

Production remains blocked until those external checks are completed.


## Browser fixture correction
The browser acceptance users originally used the reserved `.test` TLD. The API login schema uses Pydantic `EmailStr`, which correctly rejects that address with HTTP 422 before credential verification. The browser seed and test now use syntactically deliverable `@example.com` fixture addresses. This was a test-fixture bug, not an MLS initialization failure.


## MLS device registration race
Browser acceptance exposed a real server race: concurrent initialization of the same authenticated browser device could execute two SELECT-then-INSERT registration paths and hit the `uq_mls_device_user_device` constraint.

Device registration now uses PostgreSQL `INSERT ... ON CONFLICT DO NOTHING RETURNING` and then re-reads the authoritative row. Identical concurrent registrations are idempotent; a changed identity or identity-key reuse by another device still fails closed with 409.

API integration coverage now issues concurrent identical registrations and verifies all calls succeed while exactly one MLS device row exists.


## Strict-Mode MLS initialization race
After the server registration race was fixed, Chromium acceptance still showed the secure-chat button permanently disabled. Root cause: React development Strict Mode can mount MessengerShell twice quickly enough for two OpenMLS adapter instances to read an empty IndexedDB state and create different identities for the same authenticated session.

OpenMlsProtocolAdapter initialization is now serialized by its durable `stateKey`. A second same-device initializer waits for the first to persist the identity, then reloads that exact state instead of generating another identity. The server keeps its fail-closed identity mismatch check; this fix removes the client race rather than weakening that check.


## KeyPackage startup race
The next browser acceptance run reached conversation creation but the peer could not recover the Welcome after reload.

Root cause: the Strict-Mode initialization lock covered identity creation/registration but not the immediately-following KeyPackage pool refill in MessengerShell. A cancelled first mount could therefore generate/publish KeyPackages from one provider state while the surviving mount loaded or persisted another provider state. The server could hand out a KeyPackage whose corresponding private material was no longer present in the surviving browser state.

Initial KeyPackage pool refill now runs inside the same per-stateKey serialized OpenMLS initialization. MessengerShell no longer performs a second unsynchronized startup refill. Reconnect-time pool maintenance remains serialized on the live adapter.

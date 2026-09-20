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

# Progress

## Current milestone
E2EE production UI integration. Production deployment remains blocked.

## Verified E2EE baseline
Through Step 65 the repository has verified:
- MLS/RFC 9420 direct + group protocol via pinned OpenMLS 0.9.0 WASM;
- encrypted browser protocol state and crash-safe encrypted outbox;
- persistent session-bound device identities and single-use KeyPackages;
- KeyPackage/group-member identity binding, TOFU pins and safety numbers;
- two-phase add/remove/rekey with durable control batches;
- encrypted message/edit/reaction/delete events;
- encrypted attachment cryptographic/upload primitives;
- deterministic local encrypted-event projection;
- unified application/control transport ordering and durable cursor;
- offline removal catch-up for locally tracked MLS groups;
- encrypted ConversationView text/mutation UI;
- encrypted image/file/voice upload, download, local decryption and rendering;
- server activation rejects missing Welcome coverage for any active participant MLS device.

## Current step
Step 67 routes group membership add/remove through MLS before server membership changes.

## Production blockers after Step 64
- MLS-safe group membership changes and production API E2EE-only enforcement;
- safety-number verification UI;
- browser retry/reload end-to-end tests;
- final security review;
- physical iOS/Android PWA privacy/notification smoke tests;
- live infrastructure deployment verification.

## Deployment rule
Do not deploy production until all encrypted UI paths are active, there is no plaintext fallback, final CI/security review is green, and live mobile/PWA smoke tests pass.

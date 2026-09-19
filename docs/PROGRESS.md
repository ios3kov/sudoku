# Progress

## Current milestone
E2EE production UI integration. Production deployment remains blocked.

## Verified E2EE baseline
Through Step 63 the repository has verified:
- MLS/RFC 9420 direct + group protocol via pinned OpenMLS 0.9.0 WASM;
- encrypted browser protocol state and crash-safe encrypted outbox;
- persistent session-bound device identities and single-use KeyPackages;
- KeyPackage/group-member identity binding, TOFU pins and safety numbers;
- two-phase add/remove/rekey with durable control batches;
- encrypted message/edit/reaction/delete events;
- encrypted attachment cryptographic/upload primitives;
- deterministic local encrypted-event projection;
- unified application/control transport ordering and durable cursor;
- offline removal catch-up for locally tracked MLS groups.

## Current step
Step 64 activates projected encrypted history and the encrypted text composer/actions for `encryption_required` conversations. It does not call legacy plaintext history/send/edit/reaction/delete APIs.

## Production blockers after Step 64
- encrypted attachment/voice rendering + composer wiring;
- MLS-aware new-chat/group membership creation and production E2EE-only enforcement;
- safety-number verification UI;
- browser retry/reload end-to-end tests;
- final security review;
- physical iOS/Android PWA privacy/notification smoke tests;
- live infrastructure deployment verification.

## Deployment rule
Do not deploy production until all encrypted UI paths are active, there is no plaintext fallback, final CI/security review is green, and live mobile/PWA smoke tests pass.

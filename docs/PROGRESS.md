# Progress

## Current milestone
E2EE production integration. Production deployment remains blocked.

## Verified E2EE baseline
Through Step 61 the repository has verified:
- MLS/RFC 9420 direct + group protocol via pinned OpenMLS 0.9.0 WASM;
- durable encrypted browser protocol state;
- persistent device identities and single-use KeyPackages;
- KeyPackage/group-member identity binding, TOFU pinning and safety numbers;
- two-phase add/remove/rekey flows;
- encrypted application events, edits, reactions and deletes;
- client-side encrypted attachments;
- durable decrypted journal and encrypted outbound journal;
- unified application/control transport ordering with durable cursors;
- MLS devices bound to stable authenticated session UUIDs;
- full API integration, web typecheck/build and production Compose gates.

## Production blockers
- Encrypted ConversationView/history/composer is not yet activated.
- New conversations are not yet forced to E2EE-only production creation.
- Physical iOS/Android PWA privacy/notification smoke tests are not complete.
- Live DNS/TLS/storage/backups/deployment are not verified.
- Final security review must pass after UI activation.

## Current step
Step 63 hardens offline MLS catch-up after server-side membership removal.

## Deployment rule
Do not deploy production until the E2EE UI path is active, there is no plaintext fallback, final CI/security review is green, and live mobile/PWA smoke tests pass.

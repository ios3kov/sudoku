# Release Readiness Review + Hardening — 1.0

Date: 2026-09-22
Baseline: `ec557c2827b0d2b5329425016df3dfa8ddaf4f71`
Branch: `hardening/release-readiness-1.0`
Production deployment: explicitly out of scope until a separate user command.

## Frozen scope and acceptance

This pass is the final pre-deployment hardening cycle. It may fix verified release defects, add missing release gates and make narrowly justified refactors. It must not add product features, redesign the messenger, change the MLS wire protocol, or deploy production.

Critical scenarios:
1. hidden Sudoku -> private surface -> authentication;
2. direct/group MLS bootstrap and encrypted send/edit/reaction/delete;
3. no plaintext fallback when MLS/transport fails;
4. offline queue, reconnect, ordering, deduplication and reload recovery;
5. device add/remove/revocation and safety-number identity behavior;
6. encrypted attachment/voice lifecycle and notification privacy;
7. long history/drafts/actions/swipe/read receipts;
8. PWA concealment, install/update shell, network failure and recovery;
9. backup, restore, rollback and release observability.

Release support target for this review:
- iOS/iPadOS 17+ Safari / installed PWA;
- Android 12+ current Chrome / installed PWA;
- current and previous major desktop Chrome, Firefox and Safari.
Automated WebKit is evidence for browser-engine compatibility, not a substitute for physical Safari/PWA testing.

Measurable automated gates:
- 0 open P0/P1 that can be reproduced in repository/test environments;
- lint/typecheck/tests/build and dependency audits green;
- no known high-severity npm/pip/Rust dependency vulnerability;
- release-license policy has no AGPL/GPL/SSPL/BUSL dependency;
- 10k encrypted projection < 1000 ms (existing mobile CPU budget);
- production web bundle within repository budget;
- authenticated conversation-list load profile: 1000 requests, concurrency 20, 0 errors, p95 < 500 ms;
- 60 s soak, concurrency 5, 0 errors, p95 < 500 ms;
- production-mode Chromium full E2E green;
- public Sudoku/privacy surface green in Chromium, Firefox and WebKit;
- production Compose/scripts/images gates green.

Manual/external gates are never inferred from CI: WCAG 2.2 AA manual review, physical iOS/Android PWA install/update/background behavior, real-device MLS exchange, staging deployment/migration/rollback, monitoring alert delivery, and destructive restore timing require their actual environments.

## Defect register

| ID | Sev | Finding | State |
| --- | --- | --- | --- |
| RR-001 | P1 | If `MediaRecorder` construction throws after microphone permission, the acquired stream was not yet owned by cleanup and could keep the mic active. | Fixed; regression gate added. |
| RR-002 | P1 | Async attachment decryption could finish after offscreen release/unmount, rematerializing decrypted bytes/object URLs after privacy cleanup. | Fixed with mount/generation invalidation; regression gate added. |
| RR-003 | P1 | Concurrent first-use contexts could both generate the global IndexedDB wrapping key and `put` different keys; the later writer could make ciphertext written with the earlier key unreadable. | Fixed with insert-only winner + ConstraintError re-read; regression gate added. |
| RR-004 | P1 | Restore script's EXIT trap restarted app traffic after a failed destructive restore, potentially serving partially restored DB/object state. | Fixed: restore failure remains in maintenance mode and requires explicit operator recovery; executable fake-Docker regression added. |
| RR-011 | P1 | Mobile viewport disabled user zoom with maximum-scale/user-scalable, conflicting with WCAG 2.2 AA zoom expectations. | Fixed: browser zoom restored; 16px auth inputs continue preventing iOS focus auto-zoom; browser acceptance inverted to enforce zoom capability. |
| RR-012 | P1 | PWA navigation was network-first but did not refresh the cached offline root, so an unchanged service-worker script could leave an old offline shell after an app release. | Fixed: successful root navigation atomically refreshes the offline shell; private /v1 traffic remains excluded from cache. |
| RR-013 | P1 | Several 10–11px secondary labels/timestamps and placeholders used low-contrast gray; own-message timestamp was ~3.44:1 on blue. | Fixed: small secondary tokens now meet >=4.5:1 for their intended backgrounds (own timestamp ~4.6:1); regression tokens added. |
| RR-010 | P1 | Conversation-list serialization issued one member query per conversation (N+1), making large account lists scale linearly in DB round trips. | Fixed with one batched member hydration query; 200-conversation load/soak gate added. |
| RR-005 | P1 release gate | Physical iOS/Android and real two-device E2EE/PWA acceptance has not been executed in this environment. | Open external gate; must not be called passed. |
| RR-006 | P1 release gate | Staging deployment/migration/rollback and destructive backup restore with measured RPO/RTO have not been executed on staging. | Open external gate; must not be called passed. |
| RR-007 | P1 release gate | Metrics/traces exist, but no evidence yet proves production/staging alert routing and alert receipt. | Open external gate. |
| RR-008 | P2 | Encrypted event journal remains in one encrypted IndexedDB state blob; very large histories can amplify writes. | Existing residual risk; CPU projection remains budgeted. |
| RR-009 | P2 | Rust transitive `proc-macro-error2` maintenance advisory is unmaintained, not a known vulnerability. | Existing accepted residual risk pending upstream chain update. |

No RR-005/006/007 workaround is accepted. They remain explicit blockers for the user's full Definition of Done, even if all repository automation passes.

## Added hardening verification

- `scripts/release-hardening.test.mjs`: restore fail-closed, wrapping-key race policy, microphone ownership ordering and decrypted-media invalidation.
- `tests/performance/api_load.py`: authenticated DB-backed 200-conversation load + soak profile with release budgets.
- `apps/web/playwright.cross-browser.config.ts`: Chromium/Firefox/WebKit public-surface acceptance.
- `scripts/check-release-licenses.py`: npm lock, Cargo metadata and installed Python environment license inventory; forbidden release licenses fail CI.
- CI retains load-profile evidence for seven days.

## Review framework

Security/privacy review is mapped pragmatically to the applicable areas of OWASP ASVS v5.0.0 (the current stable release at audit time): authentication/session management, access control, input/file handling, API/browser origin boundaries, cryptography/key lifecycle, logging/privacy, configuration and dependency supply chain. This is an engineering review, not a third-party certification.

Performance distinguishes existing micro/profile evidence from the new DB-backed CI load/soak evidence. CI runner numbers are regression budgets, not production capacity claims.

Accessibility distinguishes automated semantics/focus/viewport checks from WCAG 2.2 AA manual and real assistive-technology acceptance.

## Definition of Done / stop rule

This hardening branch may merge only after its exact full CI is green and code review finds no open repository-reproducible P0/P1. After merge, post-merge CI must also pass.

Even then, the *full user-defined Release Readiness DoD* remains **not complete** until RR-005/006/007 have real evidence. Do not broaden feature scope after repository hardening closes. Production deploy and production smoke are separate later commands.

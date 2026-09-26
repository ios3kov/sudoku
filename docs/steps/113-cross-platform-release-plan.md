# Step 113 — Cross-platform release plan

Date: 2026-09-26  
Status: active plan  
Scope: iOS native host, Android/PWA, desktop/browser, Messenger + Sudoku shell

## Product rule

There is one user-facing product contract across all supported platforms.

iOS, Android/PWA and desktop/browser must provide equivalent behavior for:

- Sudoku -> Messenger reveal gesture semantics and physics;
- Messenger -> Sudoku concealment;
- PIN and account recovery flows;
- Contacts -> chat behavior and invite flows;
- Messenger navigation and states;
- background/privacy behavior;
- E2EE lifecycle, recovery and failure states.

Platform-specific native/web implementations may differ. A platform limitation must be explicit and documented; it must not silently weaken privacy, security or core UX.

For task/app-switcher previews, Messenger must never be exposed. The preferred result is the last real Sudoku state. Where the OS/browser does not expose direct snapshot control, the client must use lifecycle hooks to present the retained Sudoku surface before background capture whenever technically possible.

---

# Phase 1 — Cross-platform parity closure

Target platforms:

- iOS native host;
- Android installed PWA / Chrome;
- iOS Safari/PWA where still supported for web behavior;
- desktop Safari/Chrome where applicable.

Verify and align:

1. reveal gesture remains finger-tracked until release;
2. release decision uses drag distance + recent velocity/projected travel;
3. fast upward flick may commit before normal distance threshold;
4. short/slow release below threshold returns smoothly;
5. no mid-drag auto-finish or abrupt jump;
6. Messenger conceal action is immediate and local;
7. backgrounding never exposes Messenger;
8. task/app-switcher preview shows last real Sudoku state where platform control permits.

Any behavior correction made for one client becomes a parity requirement for the others unless explicitly documented as an OS limitation.

### Exit gate

- browser E2E covers shared gesture semantics;
- platform-specific lifecycle/privacy behavior documented;
- no known unexplained parity difference.

---


## 2026-09-26 Phase 1 implementation checkpoint

Branch `fix/cross-platform-privacy-parity-20260926` implements the shared web/PWA privacy half of cross-platform parity:

- the real Sudoku surface remains mounted beneath Messenger instead of being replaced by a decorative privacy screen;
- retained Sudoku is inert and its game clock is paused while Messenger is active;
- the reveal hook clears transient transforms/classes after Messenger becomes active so the retained Sudoku remains a clean full-frame snapshot source;
- `pagehide` / hidden visibility synchronously raise the retained Sudoku above Messenger through the privacy-shield class;
- restore waits for the private-surface timeout decision before dropping the shield;
- the generic Sudoku grid remains fallback-only before the first usable Sudoku state hydrates;
- browser regression coverage now verifies real retained Sudoku on privacy shielding, no generic grid after hydration, release-only commit, fast-flick commit below the normal distance threshold, and paused Sudoku timing beneath Messenger.

Pending before Phase 1 can be marked complete:

- branch CI;
- merge/post-merge verification;
- physical Android/PWA Recents/task-switcher acceptance;
- physical iPhone acceptance remains a separate Phase 2 gate.

# Phase 2 — Physical iPhone QA

Verify on the exact release candidate:

## Privacy/lifecycle

- cold launch;
- background/foreground;
- Control Center;
- Notification Center;
- App Switcher;
- force quit/relaunch;
- App Switcher card shows last real Sudoku state;
- no Messenger frame or generic fallback after a valid Sudoku frame exists.

## Reveal gesture

- slow short drag -> return;
- slow drag beyond threshold -> open;
- fast upward flick below distance threshold -> open;
- reverse movement before release -> correct return/commit behavior;
- no mid-drag auto-finish;
- no start/release jump;
- acceptable frame pacing.

### Exit gate

All P0 privacy and gesture scenarios pass on physical iPhone.

---

# Phase 3 — Physical Android/PWA + browser QA

Test the same product semantics on Android/PWA and representative browser clients.

## Android/PWA

- install/open;
- reveal gesture physics;
- conceal Messenger;
- background/foreground;
- Android Recents/task switcher;
- task preview never exposes Messenger;
- restore to the correct application state;
- contact flow and keyboard behavior.

## Browser

- Chrome desktop;
- Safari desktop where supported;
- mobile Safari web behavior not provided by the native host;
- resize/orientation where applicable;
- visibility/pagehide/pageshow lifecycle;
- keyboard and pointer/touch input parity.

### Exit gate

No unexplained behavioral difference from the product contract. OS-level limitations are recorded with the strongest available privacy fallback.

---

# Phase 4 — Complete remaining Step 112 product work

Close the remaining remediation scope:

1. fresh-device / lost-local-MLS recovery;
2. contact -> direct chat reliability and idempotency;
3. first-attempt PIN reliability;
4. modern PIN setup/unlock UX;
5. Messenger navigation/product polish;
6. remove Face ID / Touch ID product path;
7. display name/nickname onboarding;
8. country-aware phone input;
9. contacts and admin invite flows;
10. registered contacts list;
11. startup/status-bar/privacy polish;
12. shared conceal/reveal behavior across all clients.

Each completed item requires targeted tests before integration.

---

# Phase 5 — Full pre-release verification

Run on one exact candidate SHA.

## Automated

- API integration + security;
- OpenMLS/Rust;
- web lint/typecheck/build;
- domain/unit tests;
- Browser E2E;
- iOS build/tests;
- device-access;
- beat-runtime;
- api-shutdown;
- dependency/security/license checks;
- production Compose/images;
- backup/restore audit.

## Manual/physical

- iPhone;
- Android/PWA;
- two-account/two-device E2EE;
- PIN;
- Contacts -> chat;
- encrypted text/media/voice/video;
- background/reconnect/reload;
- session revocation;
- accessibility;
- weak network/device performance;
- task/app switcher privacy.

### Exit gate

No P0/P1 release blocker remains. All known limitations are explicit.

---

# Phase 6 — Release Candidate freeze

1. choose one exact SHA;
2. record it in release documentation;
3. no feature/UX changes after freeze;
4. only release-blocking fixes allowed;
5. every fix creates a new candidate SHA and invalidates prior candidate acceptance;
6. rerun affected automated checks plus the required final gate;
7. repeat critical physical smoke on iPhone and Android/PWA.

The RC is not production merely because CI is green.

---

# Phase 7 — TestFlight and production

## iOS

1. create reproducible archive from the frozen SHA;
2. record app version/build number + source SHA;
3. TestFlight install;
4. verify clean install;
5. verify upgrade over previous build;
6. verify session/MLS preservation;
7. repeat lifecycle/privacy/gesture smoke;
8. App Store only after TestFlight acceptance.

## Server/web/PWA

1. verify current production SHA;
2. fresh consistent production backup;
3. checksum + off-host copy;
4. isolated restore verification;
5. exact-SHA preflight;
6. deploy;
7. live smoke;
8. two-account functional/E2EE smoke;
9. Android/PWA smoke against production;
10. record deployed SHA/database revision.

Production deployment requires explicit authorization.

---

# Release stop conditions

Do not release while any of the following is true:

- Messenger can appear in an OS task/app-switcher preview;
- iOS/Android/browser reveal behavior materially differs without a documented OS limitation;
- reveal auto-finishes while the finger is still down;
- concealment depends on network/logout;
- correct PIN can fail on first attempt;
- Contacts -> chat can no-op or create duplicate directs;
- fresh-device E2EE recovery falls into a generic reload loop;
- plaintext fallback exists;
- two-device E2EE acceptance is incomplete;
- backup/restore gate is incomplete;
- exact candidate CI is not green;
- physical iPhone acceptance is incomplete;
- physical Android/PWA acceptance is incomplete.

---

# Definition of done

The release program is complete when the same product behavior is verified across supported clients: Sudoku launches normally, Messenger reveal/conceal feels consistent, private content never leaks into task/app-switcher previews, PIN and contact-to-chat flows are reliable, E2EE survives supported lifecycle/recovery scenarios, physical iPhone and Android/PWA acceptance pass, and one frozen exact SHA passes the complete release gate before TestFlight/production.

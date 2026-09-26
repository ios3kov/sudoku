# Step 112 — iPhone Messenger production remediation plan

Date: 2026-09-25  
Status: approved production plan after physical iPhone QA  
Scope: issues #101–#116

## Goal

Turn the current repository candidate into a production-quality iPhone Messenger experience without weakening the existing phone/session/PIN/contact-ACL/MLS security model.

The physical iPhone pass exposed two release-blocking functional defects and a broader UX debt:

- fresh iPhone reinstall / lost local MLS state shows a generic `Secure messaging needs a restart` banner and Reload does not recover it (#108);
- tapping a registered contact does nothing, so the normal one-to-one chat path is functionally broken (#116);
- correct PIN unlock can fail on the first attempt (#111);
- the rest of the Messenger/native host needs a coherent iPhone-first UX rather than a collection of technical forms and fallback states.

This plan deliberately separates protocol correctness, product UX and native polish so the riskiest changes are verified before visual work is integrated.

---

## Non-negotiable product rules

1. **No plaintext fallback.** E2EE failures must never downgrade a conversation to plaintext.
2. **Singleton admin remains authoritative.** Only the one global admin can issue/revoke invites.
3. **Phone remains account identity.** Display name/nickname is user-facing metadata, not authentication.
4. **Contacts remain an authorization/discovery input.** Full address-book access is optional and explicit; picker/manual fallback remains.
5. **PIN is the quick local unlock.** Face ID / Touch ID is removed from the product (#112).
6. **Sudoku concealment is immediate.** The persistent Sudoku icon must conceal private Messenger content locally without waiting for network or logout.
7. **Lost local MLS state is not equivalent to recoverable message history.** A fresh device may be re-added/rekeyed for future secure traffic, but old ciphertext cannot be promised decryptable if all relevant local MLS key state was deleted and no key backup exists.
8. **Exact-SHA releases only.** No production rollout from a moving `main`.

---

# Wave 0 — lock the baseline and preserve evidence

Before code changes:

- retain the fresh production backup created during this QA session;
- retain the successful isolated restore evidence;
- record the exact deployed SHA separately from repository `main`;
- keep physical-iPhone screenshots / issue comments as acceptance evidence;
- do not make further production mutations while the remediation branch is under development.

Current physical QA issue set:

| Issue | Requirement |
| --- | --- |
| #101 | reveal gesture must arm only from digit 5 |
| #102 | remove light status-bar strip |
| #103 | remove pale privacy-cover flash from normal lifecycle |
| #104 | branded native startup preloader |
| #105 | iOS-like hold-5 reveal motion |
| #106 | country-aware smart phone input |
| #107 | modern 4-cell PIN setup/unlock |
| #108 | fresh-device / lost-local-MLS recovery |
| #109 | display name / nickname onboarding |
| #110 | coherent Messenger UX + persistent instant-Sudoku button |
| #111 | correct PIN must unlock on first attempt |
| #112 | remove Face ID / biometric unlock |
| #113 | optional full iOS Contacts permission |
| #114 | admin invite by contact/name/number |
| #115 | normal registered-user Contacts list |
| #116 | obvious contact-to-chat flow |

Stop Wave 0 if the current production backup or restore evidence cannot be located and revalidated.

---

# Wave 1 — P0 functional correctness

Target: one focused PR. No visual redesign beyond what is necessary to make states truthful and usable.

## 1.1 Fresh-device MLS recovery — #108

### Problem

A clean iPhone reinstall destroys local IndexedDB/OpenMLS state while the server still knows about encrypted conversations and prior devices. The current `MessengerShell` catches multiple initialization/recovery failures and collapses them into `e2eeState = "error"`, which renders a generic Reload banner even when reload cannot repair the condition.

### Implementation

Refactor the E2EE startup path into explicit states rather than one generic error:

- `initializing`
- `ready`
- `new_device_pending`
- `rekey_pending`
- `history_unavailable_on_this_device` where applicable
- `recoverable_error`
- `fatal_error`

Required behavior:

1. register the fresh device identity and KeyPackage pool;
2. detect existing encrypted conversations for which the new device has no local tracked MLS state;
3. use the existing device-add / membership-change choreography where protocol rules allow;
4. allow an existing authorized group/direct member device to commit the new device into the MLS group;
5. surface a clear `Preparing secure messaging on this device` state while membership is pending;
6. automatically continue once the membership event arrives;
7. do not show `Reload` unless the detected failure is specifically known to be fixed by a reload;
8. distinguish future-message rekey from unavailable old history;
9. preserve fail-closed behavior if identity or membership verification fails.

Do **not** invent a key-recovery mechanism. If the only copy of historical MLS state was deleted, the UI must be explicit that older encrypted history may remain unavailable on the new device.

### Wave 1 tests

- fresh local state + empty account;
- fresh local state + existing E2EE direct conversation;
- fresh local state + existing E2EE group;
- pending device-add followed by transport event;
- revoked/old device handling;
- no duplicate KeyPackages/device registrations under remount/reload;
- no plaintext fallback;
- Reload no longer presented as generic recovery.

## 1.2 Contact -> direct chat — #116

Make the normal path deterministic and familiar:

- Chats -> new-message -> registered contact -> chat;
- Contacts -> tap registered contact -> chat.

Rules:

- reuse the existing direct conversation if one exists;
- otherwise create exactly one E2EE direct conversation;
- rely on server-side direct-key/idempotency protection so repeated taps cannot create duplicate direct chats;
- open the conversation immediately after create/reuse;
- secure-device preparation stays inside the chat state rather than exposing a protocol setup wizard;
- tapping a contact must never be a no-op.

Tests:

- existing direct chat reused;
- no direct chat -> one created;
- repeated/double tap -> still one direct chat;
- contact ACL enforced;
- non-contact cannot bypass authorization.

## 1.3 PIN first-attempt reliability — #111

Fix reliability before redesigning visuals.

Required:

- exactly one verification request per completed PIN;
- no stale unlock capability after restart;
- no race between onboarding/unlock/session refresh;
- correct PIN succeeds on the first attempt;
- wrong PIN reliably increments existing policy and permits a clean retry;
- reload/relaunch does not leave the unlock state half-initialized.

Acceptance:

- 20 consecutive physical-iPhone relaunches with correct first-attempt unlock;
- wrong PIN -> retry -> correct PIN succeeds without reload;
- no duplicate requests.

### Wave 1 exit gate

Run targeted API/unit/browser tests first. Then run the affected browser E2E group.

**Do not start Wave 2 until #108, #116 and #111 are green.**

---

# Wave 2 — Messenger product UX

Target: one integration PR after Wave 1 is stable.

## 2.1 Navigation + instant Sudoku escape — #110

Adopt a familiar messenger information architecture:

- Chats
- Contacts
- profile/settings where needed

Every private Messenger surface gets an **icon-only Sudoku button in the bottom-right**:

- one tap;
- synchronous conceal;
- no logout;
- no reload;
- no network dependency;
- preserve session and MLS state;
- safe-area and keyboard aware;
- VoiceOver label even though visible text is omitted.

The control must be available on chat list, direct/group chat, contacts, invite, devices/settings, PIN-related private surfaces, loading/error states and media flows where safe.

## 2.2 Modern PIN setup/unlock — #107

Setup:

- four large cells/dots;
- numeric keyboard;
- automatic advance;
- automatic submit after digit 4;
- confirmation screen;
- mismatch -> short error/haptic -> clear confirmation and retry.

Unlock:

- same 4-cell design;
- keyboard focused immediately;
- **no Unlock button**;
- correct 4 digits -> instant unlock;
- wrong 4 digits -> error/haptic -> all cells clear -> immediate retry;
- password fallback where policy allows.

## 2.3 Remove biometrics — #112

Product removal sequence:

1. remove Face ID/Touch ID onboarding and unlock UI;
2. stop invoking the native biometric bridge;
3. remove biometric settings surface;
4. remove `NSFaceIDUsageDescription` only after native biometric code is no longer reachable;
5. keep migration/table compatibility initially rather than introducing a destructive database migration in the same release;
6. mark server biometric endpoints dormant/deprecated first; clean schema in a later maintenance release after compatibility review.

PIN + account password remain the supported local/recovery paths.

## 2.4 Display name / nickname onboarding — #109

After registration / first successful account setup:

- ask `How should people see you?`;
- one display-name/nickname field;
- Unicode supported;
- editable later;
- duplicates allowed;
- phone number remains login/contact-matching identity;
- raw phone number is not the primary public chat label.

## 2.5 Smart phone input — #106

Create one reusable phone-input component for login, manual contacts and admin invite.

Requirements:

- explicit country selector;
- sensible initial country from device/browser locale;
- international input respected when user types `+`;
- Russian examples `926…`, `8926…`, `7926…`, `+7926…` normalize to the same valid `+7` number when applicable;
- user sees readable formatting while API/storage receives canonical E.164;
- paste with spaces, parentheses and hyphens;
- cursor does not jump during formatting;
- tests for RU plus at least one non-RU country.

## 2.6 Full iOS Contacts access — #113

Keep both modes:

- **Choose contacts** -> system picker;
- **Allow all contacts** -> explicit full Contacts permission.

Rules:

- never request broad permission silently on cold launch;
- explain why before the iOS system prompt;
- denial/revocation does not block the picker/manual fallback;
- read only required name/phone fields;
- local search remains local;
- backend persists only matched registered-user graph / selected invite target as required, not unrelated address-book records.

## 2.7 Admin invite by contact — #114

Admin Invite becomes contact-first:

- type one field;
- search local contacts by name or normalized number;
- select contact -> show name + formatted number;
- manual phone fallback;
- only canonical E.164 sent to invite API;
- only singleton admin can issue/revoke invites.

## 2.8 Normal Messenger Contacts — #115

Registered phone-book users appear as a normal messenger list:

- avatar or initials;
- Messenger display name/nickname primary;
- local phone-book name or formatted number secondary only when useful;
- search by account name, local contact name and normalized number;
- tap -> open/create direct E2EE chat;
- non-users separated into an invite/not-on-app section.

### Wave 2 exit gate

Targeted tests for each component + one integrated browser E2E covering:

`login -> PIN -> Chats -> Contacts -> contact -> chat -> Sudoku escape -> return`

Do not run a full repository audit after every UX subchange. Run it once after Wave 3 is integrated.

---

# Wave 3 — native iOS lifecycle and gesture polish

Target: one native-focused PR.

## 3.1 Status-bar / safe-area seam — #102

Synchronize native top-area background and status-bar style with the active surface.

Do not leave the root/safe-area canvas on the old pale color while Sudoku is dark.

Prefer an explicit narrow theme/state bridge over DOM inspection.

Acceptance:

- no light strip on Sudoku;
- readable status-bar icons;
- Messenger surface also intentional;
- background/foreground does not flash the wrong theme.

## 3.2 Startup preloader — #104

Add a dedicated native startup view:

- dark branded background;
- app logo;
- `SUDOKU.MOSCOW`;
- optional minimal activity indicator only if needed;
- visible immediately on cold launch;
- fades out only after the WKWebView is ready;
- no white flash;
- no reuse of the privacy cover as a startup placeholder.

## 3.3 Privacy cover lifecycle — #103

Privacy cover remains fail-closed and synchronous on resign-active/background, but becomes intentional:

- branded/dark Sudoku visual language;
- no pale placeholder;
- Control Center / Notification Center / app switcher transitions do not expose chat;
- return to foreground does not visibly flash the cover longer than necessary;
- private content remains hidden in snapshots.

Startup preloader and privacy cover are separate components even if they share visual tokens.

## 3.4 Reveal gesture — #101 + #105

Trigger:

- reveal can arm only when the initial touch starts directly on digit 5;
- all other digits, empty keypad space, board and UI never arm reveal.

Motion:

- short hold/arming delay;
- optional narrow native haptic bridge;
- vertical drag tracks finger continuously;
- ignore diagonal noise;
- no start jump;
- no release snap;
- threshold/velocity commit -> short iOS-like spring to Messenger;
- early release -> spring back to Sudoku;
- normal tap on 5 still inputs/selects 5.

Physical-device frame pacing is the acceptance authority.

### Wave 3 native tests

Add unit coverage beyond video-only tests where practical:

- lifecycle/preloader state transitions;
- privacy-cover state policy;
- reveal gesture state machine as pure logic;
- native theme/status-bar policy;
- Contacts authorization state mapping.

---

# Integration candidate

After Waves 1–3 are merged into one release branch:

## Required automated gates

Run once on the exact candidate SHA:

1. API + security
2. OpenMLS + Rust
3. Web build + static regressions
4. Browser E2E
5. Infra + restore + production images
6. ios-native simulator build/tests
7. device-access
8. beat-runtime
9. api-shutdown
10. security/dependency/license checks already present in the repository

If one shard fails from a proven infrastructure flake, rerun only that failed shard. Do not restart all successful work.

## Required P0 browser scenarios

- fresh-device/lost-local-MLS state;
- pending device-add/rekey;
- no generic Reload loop;
- registered contact -> direct chat;
- no duplicate direct conversations;
- PIN first-attempt unlock;
- wrong PIN automatic reset/retry;
- instant Sudoku conceal action;
- contact search/name/number normalization;
- admin invite from contact.

---

# Physical iPhone acceptance

Run in small blocks during QA, but the release record must eventually cover all items.

## Block A — startup/privacy

- cold launch preloader;
- no status-bar seam;
- Control Center;
- Notification Center;
- app switcher;
- background/foreground;
- force quit/relaunch.

## Block B — PIN

- create PIN;
- confirm PIN;
- correct first-attempt unlock;
- wrong PIN auto-clear;
- password fallback;
- repeated relaunch reliability.

## Block C — contacts/chat

- system picker;
- full Contacts permission;
- registered-user list;
- tap contact -> chat;
- admin invite by contact/name/number;
- display name/nickname.

## Block D — E2EE lifecycle

- fresh install / new device;
- new-device rekey state;
- direct chat text;
- two-account direct chat;
- group if in release scope;
- reload/reconnect;
- no duplicate sends;
- explicit handling of unavailable historical ciphertext on a truly fresh device.

## Block E — media

- photo Standard/Original;
- file;
- voice;
- video;
- landscape video -> return to portrait;
- background during media flow.

---

# Release strategy

## Server/web

1. freeze exact candidate SHA;
2. verify current production SHA;
3. fresh consistent production backup;
4. checksum + off-host copy;
5. isolated restore acceptance against candidate;
6. preflight exact SHA;
7. build/up;
8. live smoke;
9. minimal two-account functional smoke;
10. record deployed SHA and database revision.

## iOS

1. build from the same compatible source tag/SHA;
2. reproducible XcodeGen project;
3. physical iPhone acceptance;
4. install next build over an existing build once to prove upgrade/session/MLS preservation;
5. TestFlight only after physical P0 acceptance;
6. App Store only after TestFlight upgrade/lifecycle/privacy checks.

---

# Stop criteria

Stop the release immediately if any of these are true:

- #108 fresh-device E2EE recovery still ends in generic error/Reload loop;
- #116 contact tap does not deterministically open/create a chat;
- correct PIN can fail on first attempt;
- a wrong PIN requires manual clearing or an extra submit button remains;
- plaintext fallback exists;
- duplicate direct chats or duplicate sends can occur;
- contact ACL can be bypassed;
- non-admin can issue/revoke invites;
- instant Sudoku action waits for network or leaves private content visible;
- app switcher can expose Messenger content;
- full Contacts permission is required rather than optional;
- Face ID remains a required product path;
- exact candidate CI is not fully green;
- backup/restore gate is not green;
- physical iPhone P0 acceptance is incomplete.

---

# Definition of done

This remediation program is complete when a new user can:

1. install/open the iPhone app with a clean branded startup;
2. reveal Messenger only through the intended hold-5 gesture;
3. log in with a forgiving, correctly formatted phone input;
4. choose a display name;
5. create a 4-digit PIN and unlock reliably without an Unlock button;
6. optionally grant full Contacts access or use picker/manual fallback;
7. see registered contacts as a normal messenger list;
8. tap a contact and immediately enter a secure direct chat;
9. reinstall / add the iPhone as a new secure device without a generic restart loop;
10. send secure messages/media and recover from background/network/reload states;
11. tap the persistent Sudoku icon from any private Messenger surface and conceal Messenger instantly.

No TestFlight/App Store production claim is made until the exact candidate passes the automated and physical gates above.


---

## Wave 1 implementation log — 2026-09-26

Branch: `fix/wave1-p0-iphone-remediation`  
Baseline: `bd262e22f026f0e4789e37c50adf61526d120313`  
Production deployment: **not performed**

Implemented in the remediation branch:

- **#108 fresh-device MLS recovery**
  - E2EE startup now distinguishes `initializing`, `ready`, `new_device_pending`, `rekey_pending`, `history_unavailable_on_this_device`, `recoverable_error`, and `fatal_error`;
  - old-epoch application ciphertext received before this device's MLS Welcome is advanced past durably and explicitly classified as unavailable history instead of being decrypted;
  - actual MLS group membership is tracked separately from a transport cursor;
  - the generic `Secure messaging needs a restart / Reload` recovery path is removed;
  - initialized MLS state is retained across recoverable transport/rekey failures.
- **#116 contact -> direct chat**
  - a registered Contacts row now opens an existing direct conversation immediately or creates the unique E2EE direct conversation;
  - the existing server `direct_key` advisory lock/idempotency remains authoritative;
  - client-side contact opening is single-flight so repeated taps do not run parallel bootstrap work.
- **#111 PIN first-attempt reliability**
  - a completed four-digit PIN auto-submits immediately;
  - a synchronous single-flight guard prevents duplicate verification requests;
  - stale device-access status responses cannot overwrite an in-progress unlock;
  - a wrong PIN clears automatically and refocuses for retry;
  - the explicit Unlock button remains only for account-password fallback.

Regression coverage added/updated:

- browser fresh-device / missing local OpenMLS state with an existing encrypted direct conversation;
- old encrypted history unavailable on the fresh device, future messages recover after Welcome without reload;
- Contacts tap creates one direct E2EE chat and subsequent tap reuses it;
- PIN auto-submit sends exactly one request and succeeds on repeated first attempts after relaunch.

Verification status at this checkpoint: implementation complete; PR CI / targeted browser verification pending. Physical-iPhone acceptance remains required after automated Wave 1 gates are green.


---

## Wave 2 implementation log — 2026-09-26

Branch: `feat/wave2-messenger-product-ux`  
Baseline: deployed Wave 1 candidate `53344fabf639af9343ef2a28c2e0a11c126f8a2d`  
Production deployment: **not performed for Wave 2**

Implemented:

- **#110 Messenger navigation + instant Sudoku**
  - primary mobile navigation is reduced to `Chats / Contacts / Settings`;
  - Invite, notifications, device sessions and sign-out are consolidated inside Settings;
  - an icon-only Sudoku escape control is present on auth, PIN, onboarding, list, chat and secondary Messenger surfaces and conceals without logout/reload/network.
- **#107 modern PIN**
  - four visual cells, numeric keyboard, latest-digit brief reveal, automatic create/confirm progression and automatic unlock after digit 4;
  - mismatch/wrong-PIN clears for retry and uses short vibration feedback where the platform supports it;
  - account-password fallback and existing server lockout policy remain unchanged.
- **#112 biometrics removed from the product**
  - Face ID / Touch ID controls and automatic biometric unlock calls are removed from the web product;
  - native biometric bridge/key-store files, LocalAuthentication/Security framework dependencies and `NSFaceIDUsageDescription` are removed from the iOS host;
  - existing database migration/server compatibility can remain dormant for rollback/history; no destructive schema cleanup is mixed into this release.
- **#109 display name**
  - newly accepted accounts enter a post-registration display-name setup with live preview;
  - Unicode duplicate display names are supported; blank/control-only values are rejected;
  - display name remains editable in Settings and phone remains the login/contact-matching identity.
- **#106 smart phone input**
  - one country-aware phone input is reused for login, registration, Settings phone change, contact fallback and Invite;
  - common RU `926… / 8926… / 7926… / +7926…` variants canonicalize to the same `+7` E.164 value;
  - formatted display is cursor-preserving while the API receives canonical E.164.
- **#113 full iOS Contacts access**
  - `Choose contacts` system picker remains;
  - `Allow all contacts` first shows an in-app explanation, then invokes the iOS permission request;
  - granted/limited state is surfaced; denial keeps picker/manual fallback;
  - native code reads only contact name + phone fields.
- **#114 contact-first admin Invite**
  - when full Contacts access already exists, name/phone typeahead runs entirely on-device;
  - system picker and manual smart-phone fallback remain;
  - only the selected canonical phone number is sent to the invite API.
- **#115 normal Contacts**
  - registered contacts render as avatar/initials + Messenger display name, with local phone-book name or formatted number secondary;
  - local-name/phone search is client-side when the address book is available;
  - tap opens/reuses the direct E2EE chat;
  - unmatched phone-book contacts are shown separately as local-only `Not on Sudoku` entries.

### Contacts data boundary

Full Contacts permission does **not** upload the whole address book as stored contact records. The client reads name + phone locally, normalizes phone numbers, and sends phone numbers to `/v1/contacts/sync` only for matching. The backend stores only matched registered-user contact edges. Unmatched names/numbers are not persisted by the contact graph.

### Verification status

Wave 2 code and targeted regressions are prepared. Exact-head API/web/browser/iOS CI and physical-iPhone acceptance remain required before merge or deployment.


---

## Wave 3 implementation log — 2026-09-26

Branch: `feat/wave3-ios-native-polish`  
Baseline: verified Wave 2 candidate `c38a99cf5d0b146c3da19358ab7ab281a0eae02f`  
Production deployment: **not performed**

Implemented:

- **#102 status bar / safe-area seam**
  - native surface policy explicitly distinguishes `sudoku` and `messenger`;
  - web sends only the active surface name through the narrow `sudokuTheme` bridge;
  - Sudoku uses the dark `#1a1a1a` native canvas + light status bar;
  - Messenger uses the light `#eef2f7` native canvas + dark status bar;
  - no DOM inspection and no private/account/message data crosses this bridge.
- **#104 dedicated startup preloader**
  - system launch screen uses a dark named color asset to avoid the initial white flash;
  - `StartupView` is a separate dark branded native surface with the Sudoku mark and `SUDOKU.MOSCOW`;
  - it remains visible until WKWebView reports ready, then fades independently of the privacy cover.
- **#103 privacy lifecycle**
  - `PrivacyCoverView` is now a deliberate dark/branded Sudoku surface rather than the old pale placeholder;
  - resign-active/background transitions synchronously cover the WKWebView before snapshots can expose Messenger content;
  - foreground activation removes only the privacy cover; startup state remains independently governed by web readiness;
  - the browser/PWA privacy fallback uses the same dark Sudoku visual language.
- **#101 + #105 reveal gesture**
  - reveal handlers remain attached only to keypad digit 5;
  - gesture now uses a short hold/arming delay before drag takeover;
  - pre-arm movement beyond a small slop cancels reveal instead of jumping the screen;
  - once armed, vertical movement tracks the finger while diagonal noise is ignored;
  - commit happens on release by distance threshold or fresh upward velocity, with a short spring-like finish;
  - early/settled release springs back to Sudoku;
  - ordinary tap on 5 remains an ordinary Sudoku input;
  - optional native haptics are limited to `selection` on arm and `impact` on commit.

Native structure/tests added:

- `NativeLifecyclePolicy` for startup/privacy state;
- `NativeSurfacePolicy` for background/status-bar state;
- `NativeContactsPolicy` for Contacts permission mapping;
- pure web reveal-motion policy for arm cancellation and commit decisions;
- iOS unit coverage for lifecycle, surface policy and Contacts mapping;
- browser regressions for digit-5-only reveal, diagonal noise, threshold/velocity decisions and hold-drag-release behavior.

### Verification status

Wave 3 code is prepared. Exact-head web/browser/iOS CI and physical-iPhone acceptance remain required before merge or deployment.


### Physical iPhone QA follow-up — 2026-09-26

Accepted on physical iPhone:

- branded startup/preloader;
- no light status-bar seam;
- reveal starts only from digit 5;
- Messenger reveal is smooth enough to validate the interaction path;
- remaining previously listed Wave 3 visual checks reported OK.

Two follow-up requirements were added from physical QA:

1. **App-switcher presentation**
   - when Sudoku itself is active, iOS may show the live current Sudoku state;
   - when Messenger is active, the app-switcher must show the **last safe Sudoku state that existed immediately before reveal**, not the branded startup/loading screen and never Messenger;
   - the pre-reveal Sudoku snapshot is captured before the private transition starts.

2. **Reveal completion physics**
   - crossing a fixed progress point while the finger remains down must never auto-complete;
   - the gesture stays interactive until release;
   - on release, completion/cancel is decided from current progress plus projected upward velocity;
   - completion duration derives from remaining distance and release velocity so fast swipes finish faster and slow incomplete swipes spring back.

New automated regressions cover no-auto-commit-while-held, projected release behavior, and the native safe-surface privacy policy. Physical re-check remains required for app-switcher fidelity and final gesture feel.

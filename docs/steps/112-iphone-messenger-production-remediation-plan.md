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

## Cross-platform parity rule

All user-visible behavior introduced during iPhone remediation is a product requirement for every supported client unless the operating system makes the exact mechanism impossible.

- iOS native, Android/PWA and desktop/browser must share the same interaction semantics, states and privacy guarantees.
- Platform-specific code may differ, but the user-facing result must be equivalent.
- Gesture physics, Messenger navigation, PIN, contacts/chat behavior, conceal/reveal rules and privacy behavior are cross-platform requirements.
- For OS app-switcher/task-switcher snapshots, each platform must hide Messenger and show the last available real Sudoku state where the platform permits control of the snapshot. Where direct snapshot APIs are unavailable, the web/PWA lifecycle must switch the visible tree to the retained Sudoku surface before background capture.
- A platform-specific limitation must be documented explicitly; it must not silently become a weaker privacy or UX contract.

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

### #108 implementation checkpoint — 2026-09-26

The repository implementation for fresh-device recovery is recorded in [Step 114](114-fresh-device-mls-recovery.md). It replaces the generic Reload failure with explicit new-device pending/retry/re-login states, keeps MLS alive across ordinary background/BFCache lifecycle, polls durable transport for Welcome, adds sender-device provenance for same-user multi-device traffic, and adds browser regressions for fresh-session device-add plus same-session local-state loss. Physical-device acceptance remains open.

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

### #116 implementation checkpoint — 2026-09-26

Registered contact rows now open or reuse a direct secure chat in one tap.

- existing direct -> open immediately;
- missing direct -> create exactly one encrypted direct and enter chat/secure-setup state;
- repeated taps reuse the direct instead of creating duplicates;
- remove-contact remains a separate secondary action;
- contact rows are visually actionable messenger targets;
- Browser E2E verifies one-tap open/create and duplicate prevention.

This final integration sits on top of the fresh-device MLS recovery and PIN reliability changes, so pending-device encrypted chats open into the secure preparation state rather than becoming a no-op.

Pending: final branch CI and physical-device discoverability acceptance.

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

### #107 implementation checkpoint — 2026-09-26

Modern PIN setup/unlock is implemented on branch `feat/modern-pin-ux-20260926` with one reusable four-cell PIN component shared by onboarding and unlock.

- unlock: four visual cells over one numeric input; automatic verification on digit 4; no PIN Unlock button;
- setup: `Create PIN` auto-advances to `Confirm PIN` on digit 4;
- confirmation: auto-saves on digit 4 when values match;
- mismatch: confirmation clears immediately and remains ready for retry;
- password recovery remains an explicit form;
- Browser E2E verifies four cells, automatic transition, focused confirmation and absence of Save PIN.

Biometric removal remains separate under #112.


### #107 repository verification — 2026-09-26

PR #132 head `1918e11223d13f6c64c657044bc98f177ef1ac89` passed all required branch workflows:

- `ci` 36268660787;
- `device-access` 36268660793;
- `beat-runtime` 36268660820;
- `api-shutdown` 36268660833.

Repository implementation for #107 is verified. Remaining acceptance is physical-device PIN feel/focus/haptic verification.

## 2.3 Remove biometrics — #112

Product removal sequence:

1. remove Face ID/Touch ID onboarding and unlock UI;
2. stop invoking the native biometric bridge;
3. remove biometric settings surface;
4. remove `NSFaceIDUsageDescription` only after native biometric code is no longer reachable;
5. keep migration/table compatibility initially rather than introducing a destructive database migration in the same release;
6. mark server biometric endpoints dormant/deprecated first; clean schema in a later maintenance release after compatibility review.

PIN + account password remain the supported local/recovery paths.

### #112 implementation checkpoint — 2026-09-26

Biometric unlock has been removed from the product surface.

- PIN + account password are the supported local/recovery paths;
- DevicePinUnlock no longer detects, offers or calls Face ID / Touch ID;
- Devices settings no longer offers biometric enrollment/removal;
- the native WKWebView biometric bridge and Secure Enclave key-store files are removed;
- `LocalAuthentication.framework` is removed from the iOS target;
- `NSFaceIDUsageDescription` is removed from Info.plist;
- server biometric endpoints and migration `0018_session_biometrics` remain dormant for compatibility and later maintenance cleanup.

## 2.4 Display name / nickname onboarding — #109

After registration / first successful account setup:

- ask `How should people see you?`;
- one display-name/nickname field;
- Unicode supported;
- editable later;
- duplicates allowed;
- phone number remains login/contact-matching identity;
- raw phone number is not the primary public chat label.

### #109 implementation checkpoint — 2026-09-26

Display-name onboarding is implemented as a separate post-registration profile step.

- migration `0020_profile_setup` marks existing users complete and new invite-created users pending;
- invite acceptance no longer requires a public name before account creation;
- new/pending users see `How should people see you?` before Messenger entry;
- live preview shows the chosen name;
- Unicode names and common punctuation are supported; surrounding whitespace is trimmed;
- phone remains the login/contact identity and is not used as the primary chat label;
- `Profile` in Messenger allows later display-name edits;
- duplicate display names remain allowed;
- API/Browser/migration regressions cover onboarding and later edits.

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

### #106 implementation checkpoint — 2026-09-26

Country-aware phone entry is implemented with one reusable `PhoneInput` across login, invite acceptance, manual contact sync, and Devices phone change.

- device/browser locale selects a sensible default country;
- explicit country selector is always available;
- RU local forms `926…`, `8926…`, `7926…`, and `+7926…` normalize to the same `+7` E.164 value;
- explicit `+` international input is respected;
- pasted spaces, parentheses and hyphens are normalized;
- visible input is formatted while typing;
- caret stays stable through formatting;
- backend still receives/stores only canonical E.164;
- system-selected contacts are canonicalized using locale default when they lack an explicit country code;
- regressions cover RU, Montenegro/non-RU, login request payload, manual contact sync and caret stability.

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

- the app switcher shows the **last real Sudoku state** (current board/menu/last Sudoku screen), never Messenger;
- a generic/loading-style Sudoku placeholder is fallback-only when no real Sudoku frame has ever been captured;
- entering the Messenger snapshots Sudoku before private content replaces it;
- resigning while Sudoku is visible refreshes the cached Sudoku frame synchronously before the cover appears;
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
- no automatic finish while the finger is still down;
- on pointer release, combine current drag distance with recent vertical velocity/projected travel;
- a fast upward flick may commit before the normal distance threshold;
- a slow/short release below the commit threshold springs back to Sudoku;
- committed release -> short iOS-like settle to Messenger with duration influenced by remaining distance/velocity;
- no abrupt release jump;
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


## 2026-09-26 Wave 3 UX checkpoint

PR #121 implemented the two physical-iPhone follow-ups for app-switcher privacy and reveal physics and merged as `5b946990aa5b9270ac1f4425589b5bc6f229f2bf`.

Verified in repository CI:

- `ci` 36245249448 — passed;
- `ios-native` 36245249507 — passed;
- `device-access` 36245249438 — passed;
- `beat-runtime` 36245249449 — passed;
- `api-shutdown` 36245249417 — passed.

Still requires physical-iPhone acceptance:

- App Switcher card shows the last real Sudoku state, never Messenger and not the generic fallback after a usable Sudoku frame exists;
- dragging stays attached to the finger until release;
- fast upward flick commits naturally from velocity/projected travel;
- slow/short release below threshold returns smoothly;
- no visible mid-drag auto-finish, jump or frame-pacing regression.

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

## Active release sequence

The product-wide continuation of this remediation is defined in [Step 113](113-cross-platform-release-plan.md). Step 113 is authoritative for cross-platform parity, physical iPhone + Android/PWA QA, remaining Step 112 work, full pre-release verification, Release Candidate freeze and TestFlight/production sequencing. This Step 112 remains the detailed remediation backlog.

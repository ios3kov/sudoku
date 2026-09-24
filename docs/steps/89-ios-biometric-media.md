# Step 89 — iOS biometric unlock + native attachments

Date: 2026-09-24.

## Goal

Finish the next native-iOS P0 block after the first-party Swift host.

This step combines the secure biometric foundation already merged in PR #67 with the native attachment picker follow-up:

- Face ID / Touch ID quick unlock backed by a Secure Enclave signing key;
- one-time server challenge + signature verification;
- no stored four-digit PIN in native storage;
- system Photos and Files selection;
- existing web E2EE attachment encryption/upload remains authoritative;
- Apple privacy manifest validation in CI;
- web/PWA fallback remains unchanged.

Production deployment is out of scope for this step.

## Baseline

PR #65 added the first-party Swift/UIKit + WKWebView host and is merged as:

`cd0d91657e0654a91c2e70f9c1400dd60b602059`

Its exact post-merge CI, device-access, beat-runtime, ios-native and api-shutdown workflows are green.

PR #67 added the biometric protocol and is merged as:

`301ee0cc0719fac44d37c2c633734849b013a5da`

The biometric design deliberately supersedes the earlier Keychain-PIN-vault experiment. The native app does **not** store the four-digit PIN.

## Biometric architecture

Biometrics remain a local convenience/privacy layer and never replace the authenticated server session.

Enrollment:

1. user already has an authenticated session and enabled device PIN;
2. iOS creates a P-256 Secure Enclave private key protected with `biometryCurrentSet`;
3. only the X9.63 public key is sent to the server;
4. server binds that public key to the current session;
5. PIN change/removal invalidates the biometric credential.

Unlock:

1. web requests a short-lived, one-time biometric challenge;
2. server returns the challenge plus canonical session-bound payload;
3. native bridge validates the payload shape;
4. Face ID / Touch ID authorizes use of the Secure Enclave private key;
5. iOS signs the canonical payload;
6. server verifies the signature and consumes the challenge;
7. server issues the same bounded RAM-only `X-Sudoku-Unlock` capability used by PIN/password unlock.

Properties:

- no biometric template/data leaves iOS;
- no private key leaves the Secure Enclave;
- no PIN is stored in Keychain, LocalStorage, SessionStorage or IndexedDB;
- challenge replay fails;
- PIN lockout also blocks biometric unlock;
- changing the enrolled biometric set invalidates the Secure Enclave key;
- cancel/failure falls back to PIN/password without touching MLS state.

## Native attachment architecture

The native layer only selects bytes. It never performs application uploads.

Flow:

1. user taps the attachment button;
2. native iOS shows an action sheet with **Photo Library** and **Files**;
3. Photos uses `PHPickerViewController`;
4. Files uses `UIDocumentPickerViewController`;
5. native side enforces the current 25 MB maximum and MIME allowlist;
6. selected bytes cross the trusted main-frame bridge and become a browser `File`;
7. the existing web composer passes that `File` into the existing upload path;
8. encrypted conversations still call `uploadEncryptedAsset()` so plaintext never reaches object storage.

The bridge is available only to the main HTTPS frame on `sudoku.moscow`.

Web/PWA continues to use the ordinary hidden file input when the native bridge is unavailable.

## Privacy / permissions

- Face ID has `NSFaceIDUsageDescription`.
- Contacts continue through `CNContactPickerViewController`; no broad contacts permission is requested.
- Photos use `PHPickerViewController`; no broad Photo Library permission is requested.
- Files use the document picker.
- `PrivacyInfo.xcprivacy` is bundled and linted in macOS/Xcode CI.
- No tracking is declared.

App Store Connect privacy answers remain a release-time review and must match the final binary plus server behavior.

## Verification

Repository gates:

- API biometric enrollment/challenge/signature/replay/lockout tests;
- migration regression through `0018_session_biometrics`;
- browser native-biometric UI regression;
- native media bridge preference regression;
- web lint/typecheck/build/E2E;
- ios-native simulator compile;
- privacy-manifest plist lint.

Physical-iPhone acceptance remains required:

- Face ID enrollment;
- Face ID unlock;
- Face ID cancel -> PIN fallback;
- biometric enrollment change invalidates unlock;
- app-switcher privacy cover;
- photo selection;
- file selection;
- encrypted image/file send/open;
- sign-out/session revocation behavior.

## Stop conditions

Do not release if:

- biometric unlock stores/replays the four-digit PIN;
- biometric success can bypass the server session/PIN state;
- challenges can be replayed;
- a private key can be exported;
- untrusted frames/origins can invoke native bridges;
- native media uploads plaintext itself;
- Photos require broad library permission;
- native picker bypasses attachment MIME/size policy;
- privacy manifest or iOS build fails;
- physical-iPhone tests have not passed.

## Platform scope

- iOS: first-party Swift/UIKit + WKWebView.
- Android: existing Web/PWA.
- Desktop/browser: existing web client.

Native Android remains out of scope for this production cycle.


## Merge verification — 2026-09-24

PR #69 merged to `main` as `b6f7ac9cc185bb55a8ec476ec2daed9f204f198c`.

Exact post-merge push verification is green:

- ci `35971848950`;
- ios-native `35971848942`;
- device-access `35971848935`;
- beat-runtime `35971848965`;
- api-shutdown `35971849241`.

This merge did not deploy production or upload a TestFlight build.

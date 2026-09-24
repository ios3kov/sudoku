# Step 89 — iOS biometric quick unlock and native attachments

Date: 2026-09-24.

## Goal

Complete the next native-iOS production block after the first-party Swift host landed in PR #65.

This step adds:

- Face ID / Touch ID quick unlock layered on top of the existing session-bound four-digit PIN;
- a Keychain-backed biometric PIN vault protected by the current biometric enrollment set;
- native attachment selection through the system Photos and Files pickers;
- a privacy manifest and Face ID usage string;
- browser/native bridge regressions;
- documentation and CI updates.

Production deployment remains out of scope for this step.

## Baseline

PR #65 is merged to `main` as:

`cd0d91657e0654a91c2e70f9c1400dd60b602059`

Exact post-merge workflows on that SHA are green:

- CI `35909765615`;
- device-access `35909765584`;
- beat-runtime `35909765596`;
- ios-native `35909765676`;
- api-shutdown `35909765652`.

The native host is therefore an established repository baseline before this step.

## Biometric architecture

Biometrics are a local convenience/privacy layer, not a server authentication protocol.

The server remains unchanged:

- account login still uses phone + account password;
- the optional four-digit device PIN remains session-bound;
- PIN unlock still calls `POST /v1/auth/device-access/unlock`;
- the server still issues the RAM-only `X-Sudoku-Unlock` capability;
- revoked/expired sessions still fail closed.

The iOS layer adds `BiometricPinVault`:

- the user opts in while creating/changing a device PIN;
- iOS stores that four-digit PIN in the Keychain only;
- accessibility is `WhenUnlockedThisDeviceOnly`;
- access control is `biometryCurrentSet`;
- Face ID / Touch ID is required before the Keychain releases the PIN;
- changing enrolled biometrics invalidates the protected Keychain item;
- the PIN is never placed in LocalStorage, SessionStorage or IndexedDB;
- sign-out, PIN removal, or explicit biometric-disable clears the item.

After biometric success, the trusted main-frame bridge receives the PIN only long enough to submit it to the existing server PIN-unlock endpoint. The same-origin/XSS limitation remains unchanged: active trusted-origin JavaScript is already inside the endpoint trust boundary and can observe decrypted content after unlock.

## Native biometric bridge

The Swift host exposes only four operations to the trusted main frame:

- `status()`;
- `enroll(pin)`;
- `unlock()`;
- `clear()`.

Every script message is rejected unless it comes from:

- the main frame;
- HTTPS;
- `sudoku.moscow`.

The bridge never creates server sessions and never returns account passwords, cookies, MLS secrets or message plaintext.

## Native attachment flow

The existing web composer remains responsible for encryption and upload.

The iOS bridge only obtains one explicitly selected local file:

1. user taps the attachment button;
2. iOS displays a native action sheet: **Photo Library** or **Files**;
3. Photo Library uses `PHPickerViewController`;
4. Files uses `UIDocumentPickerViewController`;
5. the native picker applies the existing 25 MB maximum and MIME allowlist;
6. the selected bytes are returned to the trusted web app as a temporary browser `File`;
7. existing `uploadEncryptedAsset()` encrypts the file before the object-store upload.

There is no native plaintext-upload path.

The web/PWA fallback remains the ordinary hidden file input.

## Permissions and privacy

- `NSFaceIDUsageDescription` is present.
- Contacts continue to use `CNContactPickerViewController`; no broad Contacts permission is requested.
- Photos use `PHPickerViewController`; no broad Photo Library permission is requested.
- Files use the system document picker.
- `PrivacyInfo.xcprivacy` declares no tracking and documents the app-functionality data categories handled by the product.

App Store Connect privacy answers remain a separate release gate and must be reconciled with the final binary and server behavior before submission.

## QA coverage

Repository/browser coverage must prove:

- native biometric availability is detected;
- user can opt in to Face ID during PIN setup;
- no raw PIN appears in web storage;
- reload returns to the PIN gate;
- Face ID bridge returns the stored PIN only after the native-auth step;
- the existing server PIN endpoint still produces the unlock capability;
- native attachment bridge is preferred when available;
- browser file input remains the fallback when it is not;
- encrypted attachments still go through the existing E2EE upload path.

Native CI must:

- validate `Info.plist`;
- validate `PrivacyInfo.xcprivacy`;
- regenerate the Xcode project;
- compile the iOS simulator app.

## Security stop conditions

Do not merge/release if any of these are true:

- biometric success bypasses the server PIN/session gate;
- the account password is stored by native code;
- a PIN is written to web storage;
- the Keychain item survives explicit sign-out or PIN removal;
- native media uploads plaintext directly;
- an untrusted frame/origin can invoke native bridges;
- the Photos implementation requires broad library access;
- the iOS simulator build or browser regressions fail.

## Release boundary

After merge, this feature still requires physical-iPhone acceptance:

- Face ID enrollment;
- Face ID unlock;
- cancel/failure -> PIN fallback;
- biometric enrollment change invalidation;
- app background/app-switcher privacy;
- photo selection;
- file selection;
- encrypted image/file send/open;
- logout/PIN removal clearing Face ID quick unlock.

No production server deploy, TestFlight upload or App Store submission is authorized by this step.

# Sudoku iOS host

This directory contains the first-party native iOS host for Sudoku Messenger.

## Architecture

The native binary is intentionally small:

- UIKit application shell;
- persistent `WKWebView` loading `https://sudoku.moscow`;
- app-bound domains for `sudoku.moscow` and `assets.sudoku.moscow`;
- synchronous native privacy cover for app-switcher/background snapshots;
- explicit system contact selection through `CNContactPickerViewController`;
- biometric quick unlock through LocalAuthentication + a Keychain item protected by `biometryCurrentSet`;
- native attachment action sheet using the system Photos picker and Files document picker;
- selected files return to the existing web encryption/upload pipeline; native code never uploads plaintext;
- no broad Contacts or Photos-library permission and no full address-book/photo-library import;
- synchronous privacy cover before background/app-switcher snapshots.

The existing web client remains responsible for auth, PIN, MLS state, E2EE, contacts sync, conversations and encrypted attachments.

## Generate the Xcode project

Requirements:

- full Xcode;
- XcodeGen.

On the Mac:

```bash
brew install xcodegen
bash scripts/generate-ios-project.sh
open ios/Sudoku/Sudoku.xcodeproj
```

The generated `Sudoku.xcodeproj` is intentionally ignored by Git. `project.yml` is the source of truth.

## Development signing

The current bundle identifier is `moscow.sudoku.app`.

In Xcode:

1. select the Sudoku target;
2. open Signing & Capabilities;
3. choose the operator's Apple development team;
4. select the physical iPhone and Run.

No production/TestFlight/App Store release is authorized merely by generating or running this project.


## Biometric quick unlock

Biometric unlock does **not** replace the account password or server authorization.

When the user explicitly enables Face ID/Touch ID together with a four-digit device PIN:

1. the PIN is stored only in the iOS Keychain;
2. the Keychain item is `WhenUnlockedThisDeviceOnly` and protected by `biometryCurrentSet`;
3. Face ID/Touch ID is required before iOS releases that PIN to the trusted main-frame bridge;
4. the web client immediately submits the PIN to the existing `/v1/auth/device-access/unlock` endpoint;
5. the server still issues and validates the normal short-lived unlock capability.

Changing the enrolled biometric set invalidates the Keychain item. Sign-out, removing the device PIN, or disabling biometric quick unlock clears it.

The raw PIN is never persisted in web storage.

## Native attachments

The attachment button prefers the native bridge when running in the iOS host:

- **Photo Library** uses `PHPickerViewController`, which gives access only to the user's explicit selection;
- **Files** uses `UIDocumentPickerViewController`;
- one file is selected at a time;
- the native bridge enforces the existing 25 MB ceiling and MIME allowlist;
- the selected bytes are converted back into a browser `File` and then pass through the existing E2EE attachment code.

Web/PWA keeps its normal `<input type=file>` fallback.

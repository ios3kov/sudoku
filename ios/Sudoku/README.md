# Sudoku iOS host

This directory contains the first-party native iOS host for Sudoku Messenger.

## Architecture

The native binary is intentionally small:

- UIKit application shell;
- persistent `WKWebView` loading `https://sudoku.moscow`;
- app-bound domains for `sudoku.moscow` and `assets.sudoku.moscow`;
- synchronous native privacy cover for app-switcher/background snapshots;
- explicit system contact selection through `CNContactPickerViewController`;
- Face ID / Touch ID unlock through a Secure Enclave P-256 key and LocalAuthentication;
- native Photos selection through `PHPickerViewController`;
- native Files selection through `UIDocumentPickerViewController`;
- no broad Contacts or Photo Library permission;
- no native plaintext upload path: selected files return to the existing web encryption/upload pipeline.

The existing web client remains responsible for auth, PIN, MLS state, E2EE, contacts sync, conversations and encrypted attachments. Native biometrics never store the four-digit PIN: the Secure Enclave signs a one-time server challenge, and the server returns the same bounded unlock capability used by PIN unlock. Native media selection only supplies an explicitly selected browser `File`; encrypted conversations still encrypt bytes before object-store upload.

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

# Sudoku iOS host

This directory contains the first-party native iOS host for Sudoku Messenger.

## Architecture

The native binary is intentionally small:

- UIKit application shell;
- persistent `WKWebView` loading `https://sudoku.moscow`;
- app-bound domains for `sudoku.moscow` and `assets.sudoku.moscow`;
- synchronous native privacy cover for app-switcher/background snapshots;
- explicit system contact selection through `CNContactPickerViewController`;
- Face ID / Touch ID quick unlock through a Secure Enclave P-256 key and server challenge-response;
- no broad Contacts permission and no full address-book import;
- no native plaintext messaging or attachment path;
- no native storage of the four-digit PIN, account password, session cookie or MLS private state.

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


## Biometric boundary

Biometric enrollment creates a P-256 private key in the Secure Enclave with current-biometric-set protection. Only the X9.63 public key is registered with the authenticated server session. Unlock signs a one-time server challenge; the resulting server response is the same RAM-only unlock capability used by the device PIN.

Changing/removing the PIN invalidates biometric enrollment. Five failed PIN attempts also block biometric unlock until account-password recovery. Face ID / Touch ID is therefore a quick local presence check, not a replacement for the server session, account password or MLS.

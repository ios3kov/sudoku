# Sudoku iOS host

This directory contains the first-party native iOS host for Sudoku Messenger.

## Architecture

The native binary is intentionally small:

- UIKit application shell;
- persistent `WKWebView` loading `https://sudoku.moscow`;
- app-bound domains for `sudoku.moscow` and `assets.sudoku.moscow`;
- dedicated branded startup/preloader while WKWebView becomes ready;
- fail-closed privacy handling for Messenger app-switcher/background snapshots;
- the app switcher shows the current Sudoku screen when Sudoku is active, or the last safe pre-reveal Sudoku snapshot when Messenger is active;
- explicit system contact selection through `CNContactPickerViewController`;
- optional explicit full Contacts permission for local name/phone discovery;
- native Photos selection through `PHPickerViewController`;
- native Files selection through `UIDocumentPickerViewController`;
- narrow native surface-theme and haptic bridges;
- no Face ID / Touch ID product path;
- no native plaintext upload path: selected files return to the existing web encryption/upload pipeline.

The web client remains responsible for auth, 4-digit PIN, MLS state, E2EE, contacts sync, conversations and encrypted attachments. Native Contacts access reads names and phone numbers only; unmatched address-book entries remain local and the backend stores only matched registered-user contact edges.

The reveal gesture remains web-owned but uses a narrow native haptic bridge. It arms only from digit 5, tracks the finger interactively, and decides completion only on release using progress plus projected velocity.

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

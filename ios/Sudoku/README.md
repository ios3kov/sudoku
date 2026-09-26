# Sudoku iOS host

This directory contains the first-party native iOS host for Sudoku Messenger.

## Architecture

The native binary is intentionally small:

- UIKit application shell;
- persistent `WKWebView` loading `https://sudoku.moscow`;
- app-bound domains for `sudoku.moscow` and `assets.sudoku.moscow`;
- synchronous native privacy cover for app-switcher/background snapshots; it caches the last real Sudoku frame and never snapshots Messenger;
- explicit system contact selection through `CNContactPickerViewController`;
- optional full Contacts permission through `CNContactStore`, requested only after an explicit user action;
- native Photos selection through `PHPickerViewController`;
- native Files selection through `UIDocumentPickerViewController`;
- no broad Photo Library permission;
- no native plaintext upload path: selected files return to the existing web encryption/upload pipeline.

The existing web client remains responsible for auth, PIN, MLS state, E2EE, contacts sync, conversations and encrypted attachments. PIN + account password are the supported private-area unlock/recovery paths. Native media selection only supplies an explicitly selected browser `File`; encrypted conversations still encrypt bytes before object-store upload.

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


## App-switcher privacy contract

The web layer reports whether the visible surface is Sudoku or private Messenger content. The native host refreshes the cached Sudoku image when Sudoku resigns active and also captures Sudoku at the start of the hold-5 reveal gesture. If the app is backgrounded from Messenger, the privacy cover renders that cached Sudoku image instead of Messenger or a loading screen. The generic Sudoku grid is fallback-only before the first usable Sudoku snapshot exists.

The hold-5 reveal gesture remains web-driven. Dragging follows the finger continuously; the app does not auto-complete while the pointer is still down. Release commits from distance plus recent upward velocity/projected travel, otherwise it returns to Sudoku.


## Contacts privacy boundary

Sudoku Messenger supports two native contact flows:

- **Choose contacts** uses `CNContactPickerViewController` and shares only the contacts explicitly selected in that system picker.
- **Allow all contacts** explicitly requests iOS Contacts permission with `CNContactStore.requestAccess`. It is never requested on cold launch.

For discovery, the native host reads contact names and phone numbers, but the web client sends only normalized phone numbers to `/v1/contacts/sync`. Address-book names are not uploaded for matching. The API stores only matched registered-user edges (`owner_user_id -> contact_user_id`); unmatched phone numbers and unrelated address-book fields are not persisted.

If full permission is denied or revoked, the system picker and manual-number fallback remain available.

`PrivacyInfo.xcprivacy` declares Contacts as linked data used for App Functionality with tracking disabled. App Store privacy answers must stay aligned with the actual behavior above: Contacts are used for contact discovery, are not used for tracking, and unmatched address-book entries are not retained by the backend.

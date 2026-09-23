# Sudoku iOS shell

Native iOS prototype host for the existing Sudoku Messenger.

## Scope

- iOS only. Android remains the Web/PWA client.
- Capacitor 8.5.2.
- Custom Swift plugin for one-time system contact selection and LocalAuthentication.
- No production/App Store release uses a remote `server.url`.

## Prototype build

A physical-device development build may temporarily load the verified production origin:

```bash
npm install
SUDOKU_IOS_REMOTE_URL=https://sudoku.moscow npx cap add ios
SUDOKU_IOS_REMOTE_URL=https://sudoku.moscow npx cap sync ios
```

Then configure the generated iOS target and build with Xcode.

The remote URL mode is intentionally prototype-only because Capacitor documents `server.url` as not intended for production. Before App Store submission the native release must satisfy Step88's packaging decision and App Review gates.

## Native contacts

The native plugin uses `CNContactPickerViewController`. Apple documents that this system picker gives the app only the user's final explicit selection and does not require broad Contacts authorization.

The selected phone numbers are handed to the existing web contact sync flow; unmatched numbers are not persisted by the server.

## Biometrics

LocalAuthentication is a quick local privacy/unlock capability only. It does not create, refresh or replace a server session and it does not replace the existing password recovery path.

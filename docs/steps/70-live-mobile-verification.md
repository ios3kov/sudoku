# Step 70 — Physical mobile and live production verification

## Goal
Close the only remaining production blockers that repository CI cannot prove: installed-PWA behavior on real mobile devices and the live infrastructure path.

## Preconditions
- deploy only the green repository head;
- production keeps `REQUIRE_E2EE_NEW_CONVERSATIONS=true`;
- production secrets are supplied outside the repository;
- application ingress is limited to 80/443; SSH 22 is administrator-source-only;
- database/object-storage backups exist before the smoke test.

## iOS installed-PWA smoke
Use a physical iPhone/iPad installed from the production hostname.

Verify:
1. normal launch opens Sudoku, not messenger;
2. press and hold keypad digit `5` and drag upward: the entire Sudoku surface must follow the finger; release below 75% of the available path must settle back, while reaching 75% must smoothly finish the remaining 25% and reveal the private area;
3. verify the Sudoku remains fully playable before unlock: all digits 1–9 enter normally, a normal tap on `5` does not unlock, and Notes/Erase/Reset still work;
4. sign-in session persists across app restart;
5. app backgrounding/privacy cover returns visible content to Sudoku according to the configured timeout, including when backgrounded during a partial unlock drag;
6. create a new direct encrypted chat;
7. send/receive text, image and file;
8. grant microphone permission and send/play an encrypted voice note;
9. reload/reopen and confirm encrypted history recovers;
10. go offline, queue an encrypted text update, reconnect and confirm delivery;
11. enable push and confirm notification content remains generic Sudoku-only;
12. revoke the device session from another device and confirm access is removed;
13. compare and mark a safety number verified.

## Android installed-PWA smoke
Repeat the same matrix on a physical Android device, including:
- home-screen installed launch;
- background/app-switcher privacy behavior;
- Web Push delivery;
- microphone recording/playback;
- offline/reconnect;
- remote session revocation.

## Multi-device MLS smoke
With two real devices:
1. register both devices for one user;
2. create a direct encrypted conversation with a second user/device;
3. confirm both active devices receive group membership;
4. add a new device and confirm rekey completes before new authoring;
5. revoke one device and confirm it cannot decrypt future-epoch messages;
6. reload every remaining device and confirm transport cursor recovery has no duplicate Welcome or missing history.

## Live infrastructure
Verify on the production hostname:
- DNS resolves only to intended ingress;
- TLS certificate/hostname/redirects are correct;
- mutation Origin enforcement accepts production origin and rejects foreign origin;
- WebSocket Origin/session checks work;
- PostgreSQL data survives service restart;
- Redis persistence/restart behavior matches the deployment design;
- S3-compatible ciphertext upload/download works with production CORS and signed URLs;
- object store contains ciphertext only for E2EE attachments;
- backup restore is tested for PostgreSQL and required object data;
- health/readiness endpoints work behind the live proxy;
- logs contain no message bodies, cookies, attachment plaintext, keys or query payloads.

## Final production smoke
From two physical devices:
- create a fresh encrypted direct chat;
- exchange messages both directions;
- send an encrypted attachment and voice note;
- background/reopen both PWAs;
- force offline/reconnect once;
- verify safety number;
- revoke one session;
- confirm continued operation on the remaining device.

## Stop criteria
Production can be marked verified only when:
- final repository CI is green;
- iOS smoke passes;
- Android smoke passes;
- live infrastructure checks pass;
- backup restore passes;
- final two-device encrypted smoke passes;
- no plaintext fallback or privacy leak is observed.

Record device/browser versions, production commit SHA and any deviations in a deployment verification note.

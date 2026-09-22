# Step 78 — remembered login and four-digit device PIN

Date: 2026-09-22. Baseline: `1e404b2c25d4c2582b42ab8e774a60ddde5a2f4b`. Feature branch: `feat/device-pin-login`. No production deployment is authorized by this feature implementation.

## User scenario and acceptance

All invited users, including administrators, can opt in to remembering their email on this browser and set/change/remove a four-ASCII-digit PIN in Devices. The existing HttpOnly persistent session remains the account credential. On returning to the private surface or reloading, a PIN-enabled session requires unlocking before any private preview, messaging initialization or API data is allowed. Forgotten/blocked PIN can be recovered with the account password without replacing the session UUID/MLS device identity. Expired/revoked sessions require normal password login.

Remembered email is a separate opt-in preference, not a credential. Never persist the account password, PIN, PIN verifier or unlock capability in browser storage. Refusing browser storage must not break normal login. Provide an explicit forget-email control.

## Security design and constraints

A local-only four-digit verifier and JavaScript attempt counter are not a security boundary. Use a server-side, session-bound PIN verifier and durable serialized failed-attempt count. Five incorrect attempts require the account password; browser reload/storage deletion must not reset that count. Password recovery/setup use the existing login rate limiter and require a valid unrevoked session plus the full account password. PIN is never accepted by the account-login endpoint and cannot log in from another device by email.

Successful unlock issues a random, short-lived capability held only in the current tab's RAM. Private HTTP APIs require it in a same-origin header in addition to the existing cookie. WebSockets require the capability and revalidate it before forwarding/processing. Hide/background/unmount immediately forget the capability; a best-effort server lock invalidates the matching capability, not a subsequently issued replacement. Requests/results from an older lock generation cannot reopen the private UI. PIN locking must not be confused with session revocation or wipe MLS state. PIN reset and cookie refresh preserve session UUID and MLS device binding.

This is online device/session locking, not a replacement for E2EE or protection against malicious same-origin JavaScript, browser-profile/OS compromise or server compromise. The existing encrypted IndexedDB key model is unchanged. Four digits are low entropy; offline unlocking is deliberately not supported. Do not promise offline brute-force resistance, device secure-enclave protection or independent cryptographic certification.

## Work packages

1. Separate cookie/session authentication from the additional PIN capability gate. Add additive session-PIN storage/migration, status/configuration/unlock/password-recovery/lock endpoints, row-locked attempts, expiry/revocation checks and safe audit events.
2. Add opt-in remembered-email storage and accessible PIN/settings/recovery screens, shared by administrator and regular-user paths. Integrate same-origin HTTP and WebSocket capability transport; preserve the supplied design and 50% Sudoku reveal.
3. Test exact four-digit validation/leading zeros, password-required configuration, user/admin parity, wrong PIN/exhaustion/concurrent guesses, cross-session token replay, logout/revoke/expiry, refresh identity, reload/hide/late results, storage failure and no private preview before unlock. Run existing full CI and beat runtime; independently review the published diff.
4. Record exact evidence and limitations. Leave production unchanged; no success claim for unexecuted tests or a pending CI run.

## Verification checkpoint

Specification and source review only at this commit. Implementation and tests are not yet complete. Exact later PR/SHA/run evidence supersedes this checkpoint.

## Primary references

- https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

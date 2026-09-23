# Remembered login and device PIN

## UX and scope

All users, including admins, follow the same primary flow. After a successful normal phone + account-password login, the app immediately asks **Use PIN for quick sign-in on this device?**. **Set PIN** collects and confirms four digits; **Not now** enters the messenger immediately. The Devices screen remains the secondary place to change/remove an existing PIN, manage the optional remembered phone, and on the native iOS client enable Face ID / Touch ID.

Remembering the phone number is opt-in and can be undone on the login form or Devices. The existing persistent HttpOnly session cookie continues to represent account login; remembering the phone number does not store a password or grant access. During first-login enrollment, the already-verified account password is retained only in component memory for the optional PIN request and is cleared after enrollment, skip, sign-out, hide/unmount, or session teardown.

Set/change/remove PIN requires the account password. A PIN has exactly four ASCII digits and can start with zero. On reopening the private surface, reloading or backgrounding the page, a PIN-enabled session needs a new online unlock. After five wrong guesses the account password is required; reloading or deleting browser storage does not reset the server counter. Password recovery resets the counter and retains the current session UUID/MLS device identity. Expired/revoked sessions need a normal account login.

## Architecture

`SessionPin` in `app/device_pin.py` stores an Argon2 verifier, bounded failed-attempt count, SHA-256 digest of an unpredictable unlock capability and its expiry. Migration `0015_session_pins` adds the table referencing the existing sessions table. The parent session is row-locked before enroll/unlock/lock/recovery, serializing concurrent guesses and first enrollment. Session revocation, expiry and cookie rotation are revalidated after waiting for that lock. Existing IP/account password limits remain; PIN guesses also have IP/session request limits.

`get_session_context` authenticates only the existing cookie and is restricted to PIN lifecycle endpoints. `get_auth_context` additionally requires `X-Sudoku-Unlock` for PIN-enabled sessions on private APIs. The only path-specific exception is self logout, which revokes rather than reveals private data. A failed PIN gate is HTTP 423, distinct from expired/revoked-session 401.

A random unlock capability is kept only in the current tab's module RAM. Its lifetime is at most 12 hours and never beyond the session expiry at issuance. The app never persists the PIN, verifier, account password or capability to localStorage/sessionStorage/IndexedDB. Only the optional remembered phone number is stored. Hide/background clears RAM synchronously and requests best-effort server invalidation of that exact capability; late locks cannot invalidate a newer capability. Client epoch guards discard late results; a rejection for an older capability cannot lock a newer successful unlock. Lock-related request failures are retryable rather than permanent 4xx message failures.

WebSockets offer the public `sudoku.v1` subprotocol and a separate credential-bearing protocol value; only `sudoku.v1` is echoed. Credentials are never added to URLs. The server checks PIN access during authentication and before forwarding/processing events. Close code 4423 returns to the PIN gate without invoking session-revocation/MLS-clearing handling. A new unlock replaces the previous capability for this browser session and reconnects realtime. Multiple tabs sharing one session therefore do not maintain independent simultaneous unlock capabilities.

## Native biometric quick unlock

The iOS app does not store the four-digit PIN in Keychain and does not send a biometric result as a boolean trust signal.

Instead, enrollment creates a P-256 private key in the Secure Enclave. The private key is protected by the current biometric set and never leaves the device. The API stores only the 65-byte X9.63 public key bound to the current server session.

Unlock is challenge-response:

1. the cookie-authenticated client requests a short-lived one-time challenge;
2. the server returns a domain-separated payload containing the session UUID and random challenge;
3. iOS signs that exact payload with the Secure Enclave key after Face ID / Touch ID;
4. the server verifies ECDSA/SHA-256 and issues the existing PIN unlock capability;
5. the challenge is consumed whether signature verification succeeds or fails.

Changing or removing the device PIN deletes the server biometric credential and the native client clears its Secure Enclave key. Biometric enrollment changes invalidate the key through `.biometryCurrentSet`. After five wrong PIN guesses, biometric challenge issuance is blocked until account-password recovery resets the lockout. Revoked or expired sessions cannot be restored by biometrics.

The WKWebView bridge is main-frame-only, HTTPS-only and host-bound to `sudoku.moscow`. Native signing accepts only the `sudoku-biometric-unlock:v1:` domain-separated payload family, preventing the bridge from becoming a generic signing oracle.

## Endpoint contract

All routes require a valid active-user session cookie; mutation Origin checks remain in force. Responses inherit private no-store policy.

- `GET /v1/auth/device-access`: `pin_enabled`, `password_required`, `biometric_enabled`; no account details, public keys, challenges or credentials.
- `PUT /v1/auth/device-access`: account `password` plus four-digit `pin`, or explicit null to disable. A PIN change/removal invalidates biometric enrollment and returns a new capability when PIN remains enabled.
- `POST /v1/auth/device-access/unlock`: `pin`; correct -> new capability; wrong -> 403; fifth wrong/exhausted -> 429 with `X-PIN-Password-Required: true`.
- `POST /v1/auth/device-access/password`: account password recovery; same session UUID, reset attempts, new capability.
- `PUT /v1/auth/device-access/biometric`: PIN-unlocked session registers the native P-256 public key only.
- `DELETE /v1/auth/device-access/biometric`: PIN-unlocked session removes the server biometric credential.
- `POST /v1/auth/device-access/biometric/challenge`: cookie-authenticated, rate-limited, one-time 90-second challenge; blocked after PIN attempt exhaustion.
- `POST /v1/auth/device-access/biometric/unlock`: verifies a Secure Enclave ECDSA/SHA-256 signature and, on success, returns the same RAM-only unlock capability used by PIN.
- `POST /v1/auth/device-access/lock`: invalidate only the matching supplied capability.
- `GET /v1/assets/{id}/download-url`: PIN-gated JSON resolution using the existing asset ownership/membership checks and presigner. This avoids redirecting an unlock header across origins. Object bytes use a fresh request with no capability/cookie and redirect rejection. Legacy native attachments under PIN use bounded lazy blob loading and cleanup; non-PIN sessions preserve native behavior.

## Security limits

A four-digit PIN is low entropy, not MFA, an account password replacement, an E2EE wrapping key or protection against malicious same-origin JavaScript, browser-profile/OS access or a compromised server/database. Native biometrics improves local possession/presence gating but likewise does not replace the account password, server session authorization or MLS. The existing encrypted IndexedDB storage/key model is unchanged. No offline PIN unlock is provided. Authorized downloads and already issued presigned URLs cannot be recalled by closing this page. Do not collect authorization headers/subprotocols or credential request bodies in diagnostics.

## Verification / delivery

Local executed checks at publication: eight capability/storage/redirect/late-result tests, seven actual transpiled realtime lifecycle tests, standalone strict TypeScript check of device-access.ts, TS/TSX syntax transpilation and Python compilation. Local PostgreSQL/Redis/Docker and full React production build were unavailable, so service-backed API tests and browser role-parity flows are required in the full PR CI, alongside existing E2EE/recovery/operations/build coverage and beat-runtime. New `device-access` CI runs the client boundary tests. No pending remote check is claimed as a pass.

Tests cover role parity, exact PIN validation/leading zeros, hashed storage, concurrent durable attempts, password recovery/session identity, token binding/rotation/expiry, logout/revocation, WebSocket cookie-only rejection, asset authorization/header isolation, reload/remember/forget UI and preservation of existing realtime assertions.

Source transfer used a separate `ops/device-pin-targeted-patch` branch for hash-guarded edits of existing integration points. That helper workflow is not in this feature's application tree, has no production access, and is not a deployment or acceptance test. The full published diff and exact CI result remain the acceptance basis.

## Deployment and rollback

Production is unchanged by this feature. Apply the additive API migration before exposing PIN controls. Keep existing session cookie security, role authorization, E2EE wire format and 50% Sudoku reveal unchanged. Rolling back to pre-PIN API code would ignore PIN gates: do not use such a rollback with active PIN-enabled sessions. Plan session revocation/password reauthentication before any deliberate rollback of that boundary; never blindly downgrade the database or erase MLS state as a PIN recovery mechanism.

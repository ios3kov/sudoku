# Step 84 — PIN onboarding and secure reload recovery

Date: 2026-09-23

## Goal

Two independent UX defects are addressed without changing the session schema, MLS wire format, or account-password policy:

1. a normal page reload must reinitialize secure messaging instead of returning to `Secure messaging needs a restart`;
2. a successful account-password login must offer the optional four-digit device PIN immediately, for both members and administrators.

Production deployment is outside this step.

## Reload root cause

The OpenMLS browser state is intentionally protected by optimistic IndexedDB concurrency. A stale adapter must fail rather than overwrite a newer MLS ratchet/outbox snapshot.

The UI lifecycle could unmount or destroy the messenger during `pagehide` / background concealment while asynchronous adapter work was still in flight. That old adapter could later attempt a state write after a new page/runtime had already rehydrated the same durable device state. The storage guard correctly rejected that stale write as `Secure state changed in another tab; reload secure messaging`. Reloading again could repeat the lifecycle race.

The fix does **not** weaken or bypass the concurrency guard.

## Reload fix

- `BrowserProtocolStateStore.close(stateKey)` synchronously retires one adapter's ability to write while preserving the durable encrypted state.
- `OpenMlsProtocolAdapter.retire()` marks the runtime unusable and closes its state-store writer.
- adapter queue entry and persistence paths reject work after retirement;
- `MessengerShell` retires the active adapter synchronously on `pagehide`, when the document becomes hidden, and during React cleanup;
- initialization checks retirement around asynchronous boundaries so a cancelled runtime cannot resume and persist later.

Existing idempotent network recovery semantics remain unchanged. A retired writer can no longer corrupt or replace the durable state; a fresh page constructs a fresh adapter and rehydrates the latest committed snapshot.

## PIN onboarding

Primary flow after a successful normal account-password login:

1. show `Use PIN for quick sign-in on this device?`;
2. `Set PIN` opens four-digit PIN + confirmation;
3. `Save PIN` uses the existing password-authenticated `PUT /v1/auth/device-access`;
4. `Not now` enters the messenger immediately;
5. subsequent access to a PIN-enabled live session uses the existing PIN unlock screen, with account-password recovery.

The account password used for the successful login is held only in a React ref long enough to complete the optional enrollment request. It is never written to localStorage, sessionStorage, IndexedDB, or URL state, and is cleared after Save PIN, Not now, sign-out, hide/unmount, or failed-session teardown.

The PIN remains session/device scoped and online-only. It is not MFA, an offline key wrapper, or a replacement for the account password.

The existing Devices screen remains available for changing/removing the PIN and remembered-email management, but it is no longer the primary discovery path.

## Acceptance coverage

Browser acceptance now covers:

- member and administrator parity;
- first password login -> PIN offer;
- four-digit PIN + confirmation;
- `Not now`;
- no account password or PIN in browser storage;
- literal browser `reload` -> PIN gate -> successful E2EE bootstrap;
- no `Secure messaging needs a restart` banner after unlock;
- wrong-PIN exhaustion and account-password fallback;
- Devices screen still reports/manages an enabled PIN.

The browser state-store regression suite also proves that retiring one adapter blocks its later stale writes without deleting the durable state.

Final acceptance requires the exact branch-head CI (lint, tests, typecheck, build, browser E2E and production checks) to pass. No production mutation is authorized or performed by this step.

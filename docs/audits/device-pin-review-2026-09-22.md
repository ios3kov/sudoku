# Device PIN review checkpoint — 2026-09-22

## Scope and current verification

Review of PR #40 against Step78: optional remembered email and a four-digit online device/session lock, shared by administrators and members. Production and main remain unchanged. This checkpoint is not permission to deploy.

At the initial implementation, the client-boundary and beat-runtime workflows passed. Full CI on `3c649edadcecbce70ada55476ac11a1eaf622755` failed one API test (28 passed): after password recovery, the session list did not mark the expected UUID current. Diagnostic output contained equivalent hyphenated and 32-hex UUID representations. The recovery endpoint, durable five-attempt counter and subsequent cookie authentication had already passed their assertions. The test was not weakened: it still requires exactly one current session with the original identity, and checks the database identity as well.

Follow-up `92adec951a4d1c4d0e16d83076a75ae60a6623fd` normalizes UUID values only at session-list response serialization/comparison. It does not replace or mutate the persisted session identity, change cookie rotation or relax authorization. Additional direct-route regressions cover UUID objects, hyphenated strings and hex strings. The helper workflow's resulting pull-request runs required GitHub action approval and did not execute; they are not passes. This documentation commit requests the normal full integration checks for the complete reviewed candidate, including that correction.

## Separate review findings

Reviewed cookie-only versus PIN-gated dependencies, password-required configuration, parent-session row locking and committed attempt counts, token binding/expiry, stale lock/rejection guards, websocket revalidation and PIN-specific close handling, attachment capability isolation, opt-in email persistence and role-shared UI.

Security and compatibility boundaries retained:

- Every private HTTP route continues to use the PIN-gated auth dependency; the self-logout exception only revokes access. PIN management requires an already valid session and the appropriate PIN/account password, never email plus PIN alone.
- Capabilities remain in tab RAM, are not included in URLs, and are not forwarded to signed object URLs. Lock failures are retryable for the encrypted outbox rather than permanent message rejection.
- PIN recovery preserves the session UUID and does not deliberately erase MLS state. Expiry and revocation prevent subsequent PIN unlock. A pre-PIN API rollback must not silently bypass enabled PIN gates.
- The four-digit verifier does not protect against a compromised database, same-origin malicious JavaScript or local operating-system/browser-profile access. No offline unlock or independent cryptographic certification is claimed.

New API changes add a per-request PIN lookup and websocket revalidation lookup. No new latency or physical-device benchmark is claimed. The PIN-enabled browser flows, existing encrypted recovery and complete build/budget checks must pass before this feature can leave draft status.

## Completion gate

Required for the exact final feature head: full `ci`, `device-access` and `beat-runtime`, with successful migrations, API regressions, lint/typecheck, build/budget, existing browser acceptance and the member/admin PIN flows. Confirm the source tree and review any further fixes. Record terminal run identifiers in PR #40. Never reuse an earlier head's success for changed code or claim that a queued/action-required run passed. Live iOS/Android and Step70 remain separate.

# Device PIN review checkpoint — 2026-09-22

## Scope and current verification

Review of PR #40 against Step78: optional remembered email and a four-digit online device/session lock, shared by administrators and members. Production and main remain unchanged. This checkpoint is not permission to deploy.

At the initial implementation, the client-boundary and beat-runtime workflows passed. Full CI on `3c649edadcecbce70ada55476ac11a1eaf622755` failed one API test (28 passed): after password recovery, the session list did not mark the expected UUID current. Diagnostic output contained equivalent hyphenated and 32-hex UUID representations. The recovery endpoint, durable five-attempt counter and subsequent cookie authentication had already passed their assertions. The test was not weakened: it still requires exactly one current session with the original identity, and checks the database identity as well.

Follow-up `92adec951a4d1c4d0e16d83076a75ae60a6623fd` normalizes UUID values only at session-list response serialization/comparison. It does not replace or mutate the persisted session identity, change cookie rotation or relax authorization. Additional direct-route regressions cover UUID objects, hyphenated strings and hex strings. The helper workflow's resulting pull-request runs required GitHub action approval and did not execute; they are not passes.

## Reproduced enrollment failure and correction

The resumed review verified the actual published head `6fb014919c8603da7b50cc5ba96f1134277295e2`, rather than relying on the previous conversational status. Its full CI run `35735917339` failed 10 API tests (22 passed): PIN enrollment called `hash_password("0123")`, which correctly rejects passwords shorter than 12 characters. This was a real application HTTP 500, not a missing `last_seen_at` field in a test fixture. The current session-list response does not read that field. No fixture or assertion was weakened to hide this defect.

Acceptance criteria for the correction:

- Enrollment and verification accept exactly four ASCII digits, including leading zeros. Account-password minimum length stays at 12 characters.
- PIN hashing uses the existing Argon2id work factors and a fresh random salt, with a PIN-specific context prefix so raw PIN/password verifiers are not interchangeable.
- Invalid PIN shapes and corrupted PIN verifiers fail closed; password-required setup/removal, durable five-attempt limit, session identity, HTTP/WebSocket gates and attachment authorization remain intact.
- Complete API tests, client regressions, production web build, browser acceptance and existing infrastructure gates must pass on the final head. No merge or production deployment is authorized by this correction.

Changes: `72b1ce7` adds PIN-specific hash/verify helpers; `6f56c5e` wires enrollment and unlock to those helpers; `d083e82` adds 18 regression cases in `tests/api/test_device_pin_hashing.py`. Local red/green verification executed the new tests against the unchanged security module first (18 failures due to missing PIN helpers), then the corrected module (18 passes using real Argon2). Python compilation passed. Local execution used a standalone test directory to avoid importing unavailable PostgreSQL/Redis integration fixtures; this is not a local full-API run.

On `d083e82455087c6dce5df9d47b7253d3f87aa76d`, CI run `35736999900`, job `106776704468`, subsequently passed compilation, Python lint, dependency audit, migration and the complete API integration step. At this documentation checkpoint the OpenMLS build was still running and downstream web/browser/infrastructure gates were pending. These partial results are not a full CI pass. Terminal results for the final head belong in PR #40 without creating a new source commit merely to record run completion.

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

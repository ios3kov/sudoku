# PR #34 — behavioral verification follow-up

Baseline for this follow-up: `7b4a0fadcef60750d503db2a79d90c5b5b29f766`.
Full CI #310 passed on that revision. That pass did not cover the lifecycle and
transaction-abort cases below, so it is not the verification of this correction.

## Bounded acceptance and tasks

Keep the existing release scope and protocol. Replace source-pattern checks for
media/state storage with actual component/native-storage behavior. Verify that
concealment cancels pending microphone permission and unpublished voice work,
errors do not upload final data, a normal Stop still sends once, and cancelled
attachment downloads do not create retained object URLs. A storage operation
must resolve only after its transaction commits and reject after rollback.

A separate paired PostgreSQL profile compares the baseline list function from
`ec557c2827b0d2b5329425016df3dfa8ddaf4f71` with the current function against the
same 200 conversations. Require identical output, excluded pending members and
201 -> 2 SQL queries (authentication excluded). Report timings, not an assumed
speedup. Retain raw samples, source digest, candidate commit and sample order.
No production request, deployment, migration or restore is part of these jobs.

## Reproduction (red)

The test-only checkpoint `792e3bf035d5b4bc4f7e70abfef63e5a989055bd` added no
application changes. `hardening-behavior` run `35704277762`, job `106669341014`,
executed 14 scenarios: **9 failed / 5 passed**. The failures were assertions about
actual state, not timeouts or missing tooling. Its trace artifact is `10683941749`.

- Five media failures reproduced both locally and in CI: a permission grant after
  Hide started a recorder; double-tap opened two permission requests; recorder
  errors uploaded queued final data; upload completion after Hide published a
  message; failed voice decryption caused an unhandled rejection.
- Four native IndexedDB failures: put/delete reported success despite rollback;
  an aborted key insertion could leave ciphertext without its wrapping key; a
  put promise resolved before the native transaction-complete event.
- Positive controls passed: ordinary Stop, constructor/start cleanup, offscreen
  and unmounted attachment invalidation, and concurrent key first-use round trip.

The media fixture uses real production React views, with controlled hardware and
transport edges; it is not a physical microphone, real encrypted upload or
real-device E2EE test. Storage uses the production store and **native IndexedDB,
WebCrypto and CryptoKey**, without a mock storage engine. The browser routes only
a synthetic localhost test page. No test endpoint ships with Next.

## Root causes and corrections

RR-014 (P1): the request-level success callback acknowledged persistence before
IndexedDB committed its transaction. `transactionRequest` now resolves on
`complete`, rejects on `abort`, and write transactions request strict durability.
The existing V1 record shape, database version, wrapping-key identity, insert-only
key creation, AES-GCM and MLS protocol are unchanged. This tests transaction
atomicity; it does not simulate physical power failure or certify storage hardware.

RR-015 (P1): recorder/permission/upload callbacks outlived their view. A per-view
lifetime and per-recording generation now reject late permission grants, prevent
concurrent starts and prevent publication after disposal. Cleanup detaches all
handlers before stopping the recorder, including already-inactive recorders with
queued stop events. Microphone tracks and chunks are released on every exit.
A previously initiated ciphertext upload can finish as an orphan, but the disposed
view will not publish it. Already-submitted durable sends retain existing semantics.

RR-016 (P2): voice attachment clicks ignored a rejecting decrypt promise. The
handler now consumes that rejection while preserving the generic visible error.

## Review and local evidence

Before correction, the local component command failed in five cases. After the
correction it passed **9/9**, then **18/18** in two repetitions. Domain tests:
24/24. Existing restore/PWA/contrast script checks: 3/3. TypeScript and production
Next build passed. ESLint: zero errors, 17 existing warnings. Bundle budget:
215,366 bytes total JS gzip, largest chunk 71,470; WASM 2,709,987 bytes unchanged.

The local browser policy prevents localhost navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`),
so native storage cases are exercised in the mandatory CI job, never silently
skipped. Local component cases use `setContent`. Pinned Node dependencies and the
previously built WASM came from repository artifacts, not a local reinstall or
local Rust build. Source bundle SHA/tree was checked against the immutable baseline.

Review covered stale callbacks, duplicate starts, error-stop ordering, normal
send preservation, transaction aborts and key creation. Regex assertions for
media/storage were removed only after their behavioral replacements were wired
into CI. Existing protocol/E2E checks remain required; no timeout or retry relaxed.

## Remaining evidence / release boundary

Exact corrected-head results for both `ci` and `hardening-behavior` must be recorded
before merge. The paired database timings are pending execution at this checkpoint.
Results on old commits do not satisfy this gate.

The broader release review is still open: physical devices and installed PWAs,
manual WCAG/assistive-technology acceptance, account/key recovery, extended soak
and memory profiles, staging deployment/rollback/restore with agreed RPO/RTO, and
alert delivery are not certified by this follow-up. License inventory still has
metadata-unknown entries and does not establish infrastructure-license compliance.
No additional feature is authorized and no production change is made.

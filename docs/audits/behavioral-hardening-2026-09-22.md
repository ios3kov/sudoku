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

## Concurrent main reconciliation and fresh verification

While this branch was being verified, PR #35 was merged as
`24f1152f24e5f9d661866ce30ffafe3ce550cd33`; PR #36 subsequently changed only four
Markdown files in `a4da4b0f981fc9b31ad84be53f8fa548b7f47489`. PR #34 became
conflicted, which prevented new pull-request CI runs. The resolution preserves
both parents, including the upstream documentation/archive; it does not force
replace main or treat the old PR's cached base SHA as authoritative.

Conflict decisions (supersede the earlier implementation details above):
- Retain upstream's shared `useVoiceRecorder` for both encrypted and legacy views,
  rather than duplicate recording state. Keep the additional encrypted-view
  lifetime guard against publication when a ciphertext upload finishes after Hide.
- Retain upstream's abortable single-flight attachment loader and generic retry UI.
- Retain upstream's atomic key recheck/insertion, transaction-complete acknowledgement,
  observed-ciphertext comparison and closed-state protection; request strict
  durability for readwrite transactions. The key-abort test injects into both put
  and add so its integrity assertion does not depend on the chosen insert method.
- Retain upstream's complete backup inventory validation, maintenance lock,
  transactional restore and bounded object-store readiness. Adapt the fake backup
  to its canonical manifest and error wording; preserve exit code/no-restart checks.
- Retain both fixture builder interfaces, both CI regression sets, independent
  transport payload batching and conversation-list member batching, upstream
  timestamp memoization/44px controls, and this branch's zoom/PWA/contrast work.

RR-017 (P2 UX): actual combined-browser verification exposed an 80px anchor jump
when an asynchronous media resize occurred before a queued programmatic scroll
event. The scroll callback re-saved post-resize geometry before ResizeObserver
could restore the old anchor. This also reproduced once in five repetitions of
the unchanged existing scenario. A deterministic same-offset scroll-event test
failed before the correction. Recording the already-anchored scrollTop and ignoring
its delayed event preserves the pre-resize anchor; genuine user scroll changes
still update intent. The original assertion and its tolerance remain unchanged.
A deterministic positive control verifies subsequent real user motion/arrivals.

Local combined-source results:
- Existing + both audits' real-component browser scenarios: **35/35** passed.
- Original and deterministic anchor scenarios repeated five times: **10/10** passed.
- Domain: **24/24**; client/concealment/storage/refresh: **23/23**.
- Maintenance fake-Docker fault/success tests: **8/8**; release script checks: **4/4**.
- TypeScript and production Next build: passed. ESLint: **0 errors / 14 warnings**.
- Bundle: **216,079 bytes JS gzip**, largest **71,470**, WASM **2,709,987** raw,
  service worker **2,823** raw; budget passed. The combined test/build command
  reached the tool deadline; a separate build rerun exited 0 with no source change.

These results apply to the resolved working tree, not an assumed hosted CI result.
The native storage and paired PostgreSQL jobs must run on the newly published
merge SHA. Existing native CAS/revocation tests remain in full CI. No generated
Next files, temporary instrumented source, local tools or plaintext data are
included. CSSOM's queued scroll-event model and IndexedDB transaction/durability
semantics were checked against their primary W3C specifications:
https://www.w3.org/TR/cssom-view/#scrolling and https://www.w3.org/TR/IndexedDB-3/.
Strict durability remains a browser hint, not a power-loss guarantee.

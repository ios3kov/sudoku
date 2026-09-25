# Release baseline audit — 2026-09-24

Status: started; no global audit or release acceptance claimed. Baseline main: `a8001ceb4bb292a334e0359c78bb6fa624687b83`. Follow [Step103](../steps/103-release-audit-program.md).

| ID | Priority | Finding / evidence | Next action | Status |
| --- | --- | --- | --- | --- |
| REL-001 | High release gate | Task-local offline QA `Sources/PreviewApp.swift` returns 401 for `/v1/` and has no native account bridges. It proves UI behavior only. | Prepare candidate test environment and two-device/account matrix; record actual environment versions. | Open |
| REL-002 | High release gate | Native `SudokuViewController.swift` loads the production origin. A native rebuild does not publish candidate web/backend changes. | Bind acceptance evidence to native, web and server versions; select isolated environment before unreleased end-to-end tests. | Open |
| REL-003 | Medium evidence gap | Earlier progress entries describe merged work as pending and Step101 still requests maximum-text acceptance after the operator closed further work. | Add a current superseding status and retain historical evidence; do not mark VoiceOver/physical acceptance complete. | Fixed in this documentation change |
| REL-004 | High release gate | No new physical two-device or measured performance evidence has been collected in this audit. | Obtain device/account availability, execute matrix, then capture profiling baseline. | Open |

## First inspection

Reviewed the native origin, offline QA HTTP handling, existing Step70 device matrix, Step101 and production-plan gates. Step70 is a historical PWA checklist and includes email-login wording; the current physical matrix must use phone login and native bridge behavior. Existing automated CI is useful repository evidence but does not cover these missing physical/environment gates.

No product defect has been newly established by this initial inventory. Entries above are validation prerequisites and documentation gaps, not claims that authentication or E2EE is broken.

## Technical audit pass 1

Reviewed `deps.py`, asset upload/completion/download routes and the shared download-URL authorization path. The routes use session and PIN capability checks; asset reads require ready status and ownership or conversation membership (excluding pending additions). This is a source-review observation, not a penetration-test or complete ACL proof.

Executed six existing Node regression files covering device access, refresh queues, concealment, encrypted browser storage, realtime recovery and message receipts: **40 passed, 0 failed**. These controlled tests do not substitute for live two-account exchange.

**REL-005 — Medium, fixed locally:** the bundle-budget gate counted a missing OpenMLS WASM artifact as zero bytes, allowing that condition to satisfy its size limit. It now fails for missing or empty artifacts. An isolated temporary build fixture verified missing and empty files fail and a small nonempty artifact passes. This checks artifact presence/size only, not WASM validity or crypto behavior; existing OpenMLS build and interop checks remain required.

The existing messenger profiling script was attempted with the downloaded Chromium runtime; browser startup terminated with SIGTRAP under the local sandbox. No performance measurements were produced or claimed. Physical and browser performance gates remain open.

The operator requested independent work without interactive login assistance. Continue source review and automated checks; do not mark real-account or physical-device scenarios passed without evidence. iPhone plus desktop is the initial cross-client functional matrix; a second iPhone is reserved for later native behavior checks.

## Technical audit pass 2 — bounded media verification

**REL-006 — Medium, fixed awaiting CI:** upload completion checked object length with HEAD but read the subsequent GET to EOF without a byte bound. An object replaced between requests could consume more bandwidth and worker time than its declared size. Extracted bounded hashing now reads at most the declared size plus one byte, rejects excess/short streams and closes the response on success and failure. Four local unit tests pass: valid multi-chunk digest/prefix, truncated object, endless source bounded to size+1, and read failure cleanup. Tests are included in the existing API CI discovery. Full API/S3 integration remains for CI; this does not claim object immutability or eliminate signed-upload URL reuse.

Reviewed orphan cleanup: pending/rejected and unlinked ready objects older than 24 hours are selected in bounded batches; object deletion precedes database deletion. No lifecycle-policy change was made in this pass.

## Technical audit pass 3 — client download memory

**REL-007 — Medium, fixed awaiting CI:** encrypted downloads previously called `response.arrayBuffer()` before validating the digest or plaintext length. The new streamed reader retains only the expected ciphertext size (authenticated plaintext length plus the 16-byte GCM tag), capped at the existing 25 MiB plaintext limit, and cancels on overflow or invalid metadata. It rejects short responses and releases locks on errors. Browser/network internals may buffer a chunk; this is an application retention bound, not a total-process memory guarantee. Digest and AES-GCM checks remain mandatory before returning a file. Five tests cover exact multi-chunk bytes, overflow cancellation, truncation, invalid sizes and read errors. Local typecheck and zero-warning lint passed; regression is wired into CI.

**REL-008 — Open investigation:** signed PUT URLs last ten minutes, are not conditional writes, and target the same key used after completion. The completion fast path returns ready assets without re-verification. Source review therefore identifies possible replacement of verified bytes while the URL remains valid. Encrypted client digest/authentication checks prevent silent acceptance of changed content, but availability and legacy plaintext integrity require further object-store integration investigation. Bounded-read fixes do not resolve write immutability. Do not claim exploitation or closure without integration evidence.

The local operations suite attempted 25 tests and reported seven failures and three errors on macOS, including missing Linux `flock` and `os.pidfd_open`. This run does not pass operations acceptance; Linux CI remains required and failures there must be investigated independently. No real backup/restore or service operation was performed by these mocked tests.

## Technical audit pass 4 — conditional object creation

REL-008 mitigation prepared: both plaintext legacy and encrypted upload intents sign `If-None-Match: *` and return that required header to the existing upload client. This prevents a compliant store from replacing an existing key through the newly issued URL. The E2EE integration regression checks that the condition is signed, repeated PUT returns 412, and completion remains idempotent. Existing files need no migration. Already issued URLs retain their previous semantics until expiry; deleting an object can permit recreation while a URL is valid, so this is not general object-lock protection.

Reference: [AWS conditional writes](https://docs.aws.amazon.com/us_en/AmazonS3/latest/userguide/conditional-writes.html). Moto evidence does not establish compatibility with the production MinIO revision. Verify first upload, rejection of repeated PUT, unchanged downloaded bytes and CORS against the pinned MinIO service before any release. Do not remove the signed condition as a compatibility fallback. REL-008 remains fixed awaiting integration/provider verification, not closed.

Local boto3/Moto experiment passed: condition present in SigV4 signed headers, initial write succeeds, repeat returns 412, downloaded bytes remain original. This experiment used an isolated mock bucket and no real storage. Ruff passed for changed Python files, and the four bounded-stream unit tests passed again. Full API HTTP integration awaits CI.

## Provider verification gate

The pinned MinIO source (`RELEASE.2025-10-15T17-29-55Z`, `cmd/object-handlers.go`) installs a PUT precondition callback for If-None-Match. CI now starts an isolated container from the already-built pinned image and exercises real signed HTTP requests for legacy and encrypted MIME types: first upload, repeat rejection, omission of the signed condition, unchanged stored bytes and simultaneous creators. The container exposes only loopback port 19000, uses disposable credentials/data and is removed on step exit. Local lint/syntax checks are not a runtime pass; wait for this CI step. Browser CORS acceptance remains separate.

## Recovery and regression coverage checkpoint

Added a real loopback HTTP regression: a server begins a response and stalls; aborting fetch interrupts the bounded reader, releases its lock, and a subsequent request returns the complete expected bytes. Six bounded-download tests and the 40 existing access/recovery/storage tests pass together (46 total). Added four persistent bundle-budget regressions for missing, empty, nonempty valid-sized and oversized encryption artifacts; all pass locally and are wired into CI. These are functional checks, not performance measurements.

Source review of encrypted attachment teardown confirms it aborts the current request, invalidates the generation, releases object URLs and clears file references. Completion also checks generation after WebCrypto, which cannot itself be aborted. This observation plus the loopback regression does not replace real background/memory-pressure testing on iPhone.

For head `9c2bb7e`, GitHub API integration tests passed; the full workflow was still building OpenMLS when inspected. Do not treat this intermediate checkpoint as full green or as a MinIO runtime result.

## Verified checkpoint — PR #85 merged

PR #85 merged as `a3892f1100c1270f255b864db4019d837a2eb5a3` after all five checks passed on exact head `8e350116cffd97468db93bdf78d2b010f743e39e`. [CI run](https://github.com/ios3kov/sudoku/actions/runs/36052862125) passed API integration, browser E2E, Linux operations regressions, pinned MinIO conditional uploads and production image builds. This supersedes the awaiting-CI notes above: REL-005/006/007 have automated verification, and REL-008 has real pinned-provider HTTP verification. Release-environment browser CORS and physical acceptance remain open. No deployment occurred.

## Technical audit pass 5 — upload transport recovery

**REL-009 — Medium, fixed locally:** both legacy and encrypted upload PUTs used XHR without a deadline or abort handler. A stalled transfer could retain the caller's pending promise and keep the composer busy indefinitely. Set a five-minute total PUT deadline (including waiting for the storage response), and reject on timeout or abort so existing caller error/finally paths can recover. Slow transfers exceeding this deadline require a manual retry; no automatic retry or reuse of conditional PUT URLs is introduced.

Eight controlled transport regressions exercise both public upload functions for timeout, abort, network error and HTTP 412, then a successful fresh attempt. They verify failure does not invoke completion, required conditional headers are forwarded, retry obtains another intent, and successful progress finishes at 100. These simulate XHR events and do not prove real iPhone network behavior or elapsed browser timeout accuracy. Cancellation when leaving a conversation and end-to-end request deadlines remain separate follow-up review items.

Source inspection also confirmed both repository CORS templates allow request headers via `AllowedHeader: *`; this is configuration evidence only, not proof of the live bucket's applied policy.

## Technical audit pass 6 — encrypted upload screen lifetime

PR #86 merged as `603ca095129c22337fb3d4f3042be6494f968bda` after all four applicable checks passed for `a2299037772c3f46676694dd0e9fa1f07cb018cc` ([CI](https://github.com/ios3kov/sudoku/actions/runs/36056056562)). REL-009 has automated verification; native CI was path-filtered. No deployment occurred.

**REL-010 — Medium, fixed locally:** encrypted conversation cleanup aborted photo preparation but did not cancel an active upload; file and voice continuations could reach message submission after the screen unmounted. Pass the existing screen-lifetime signal through encrypted upload preparation, intent/completion fetches and the storage PUT. Recheck cancellation before durable message submission and suppress cancelled-screen error handling. Remove PUT abort listeners when requests settle. WebCrypto already in progress cannot be interrupted; cancellation prevents subsequent network work when it finishes.

Four additional transport regressions cover cancellation before reading, during file reading, during PUT, and immediately after successful PUT (including listener cleanup). Together with the eight prior cases, 12 tests pass locally. These are controlled cancellation tests, not physical background acceptance. Cancellation cannot retract a request already processed by a server or a message already submitted to the durable outbox. Orphan cleanup handles uploaded but unlinked assets under its existing policy. Legacy conversation cancellation remains outside this encrypted-flow fix.

## Technical audit pass 7 — request-log privacy

PR #87 merged as `f7ba8fce00b251bbeedc1fdd89a6657cfdb2e0c9` after all four applicable checks passed for `511c8490ad27e0d1e05d9659da9309aa402f8589` ([CI](https://github.com/ios3kov/sudoku/actions/runs/36058233522)). REL-010 has controlled automated verification; physical background acceptance is still open.

Inspected request middleware, structured logging, metric recording and repository Caddy configuration. The API access event records a normalized route template (or `unmatched`), generated request ID, method, status and duration. It does not intentionally record raw paths, query strings, headers or bodies. Uvicorn access logging is disabled in application setup, and HTTPX/HTTPCore logging is restricted to WARNING. Repository Caddy configuration has no explicit access-log directive. These are source observations, not verification of the deployed logging configuration.

Added four ASGI request regressions exercising the actual request middleware with synthetic secrets in route parameters, query strings, authorization/cookie headers and a JSON body. Successful, unmatched and exception requests keep those values out of the captured `http.request` events and metric calls; health requests emit neither. Tests also check matched route normalization, request-ID correlation and successful private-response `no-store`. All four pass locally with lint. They run under existing API CI discovery; full CI remains pending.

No production-code defect was established in this slice. This does not prove all logs are secret-free: exception logging outside this middleware, nested structured values, CLI output, transport DEBUG logs and external telemetry exporters remain outside these tests. No production logs, real secrets or account data were accessed. Next privacy evidence should cover the complete configured logging pipeline and SQL/Redis telemetry export before claiming a global logging audit pass.

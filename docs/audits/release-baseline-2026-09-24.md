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

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

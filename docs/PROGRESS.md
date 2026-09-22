# Progress

## Current milestone — pre-deployment audit merge

Snapshot date: 2026-09-22. This is the current project/release index. Earlier progress is preserved byte-for-byte in [the historical checkpoint](audits/progress-before-pr35-merge-2026-09-22.md); statements labelled "current" inside that archive are historical, not the current release status.

The agreed Messenger UX 3.0 and the pre-deployment audit corrections are merged. No new product phase, redesign, dependency, database migration or MLS wire-format change was added during the merge step.

| Evidence | Exact identity / result |
| --- | --- |
| Audit PR | [#35](https://github.com/ios3kov/sudoku/pull/35), squash-merged after user approval |
| Audited PR head | `4aea0f4888a4ed86028afacab0df4d973e1a6670` |
| Full PR gate | [CI #311](https://github.com/ios3kov/sudoku/actions/runs/35702589645), completed / success |
| Application release candidate | `24f1152f24e5f9d661866ce30ffafe3ce550cd33` |
| Candidate source tree | `3b87cc0aeb7e7d8e43a2fc8900d143ecbaa8cf64`, identical to the audited PR tree |
| Post-merge gate | [CI #313](https://github.com/ios3kov/sudoku/actions/runs/35705703951); observed result and gate decision in [Step 75](steps/75-audit-merge-verification.md) |
| Production deployment | Not performed by this step; requires separate explicit authorization |
| Live/physical Step 70 | Still open and deferred; not replaced by CI |

The release candidate above is an immutable application commit. Documentation-only follow-ups do not designate a new application candidate or claim a full-CI execution for their own commit. Any subsequent application, dependency, workflow, build or infrastructure change needs its own exact-SHA verification.

## What is included

PR #35 corrects late microphone/decryption completion after concealment, recorder ownership and retry, server/browser session revocation, atomic encrypted-state persistence and stale-writer rejection, fail-closed restore handling, authorized history payload batching and unnecessary timestamp formatting during typing. The supplied messenger design and 50% whole-screen Sudoku reveal are preserved.

Implementation, regression and measured performance evidence is in [the audit](audits/predeployment-2026-09-22.md). Its local/pending-CI prose is a historical checkpoint; the exact PR/post-merge evidence above and [Step 75](steps/75-audit-merge-verification.md) supersede that gate status without changing its measurement limitations.

Existing encrypted direct/group messaging, attachments/voice, encrypted local protocol state/outbox, reload/reconnect recovery, membership/rekey and session concealment remain part of the integrated regression gate. This is automated implementation evidence, not independent cryptographic certification.

## Verification and remaining risks

PR CI #311 passed all required steps, including API integration, pinned OpenMLS, lifecycle/storage/maintenance regressions, TypeScript/lint/build, browser acceptance with native IndexedDB and encrypted recovery, bundle budget, MinIO/Compose and production image builds. Post-merge verification is recorded separately in Step 75; historical CI does not certify a changed application.

Retained limits: encrypted-snapshot write amplification for large histories; reload-required multi-tab conflicts rather than seamless reconciliation; fixed-viewport/no-pinch accessibility tradeoff; existing inline-script CSP architecture, ESLint warnings and transitive Rust maintenance warning. The audit does not claim a complete WCAG pass, independent penetration test, formal crypto proof, real-device performance or successful real backup restoration.

## Next release boundary

After the exact post-merge gate succeeds, the next application step is an explicitly authorized deployment of the verified candidate using [the production runbook](PRODUCTION.md), with recorded running identity and live smoke. The repository's CI workflow tests/builds on a main push and does not itself deploy the Selectel service.

[Step 70](steps/70-live-verification.md) still requires real worker delivery and two-device direct/group flows, invite acceptance, installed iOS/Android PWA background/push/keyboard/voice checks, persistence across restart/reboot and a controlled PostgreSQL plus encrypted-object restore drill. These are deferred, not passed or waived. Do not run a destructive restore without its separate authorization and recovery safeguards.

The historical live-verified SHA `68211e02` is not evidence of the current running version. Do not mark production verified until the deployed candidate has passed the applicable live/physical acceptance.

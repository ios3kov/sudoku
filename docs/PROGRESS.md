# Progress

## Active Release Readiness Review — PR #34

2026-09-22. PR #34 remains open. Its behavioral-hardening branch has been
reconciled with the independently merged audit PR #35 (`24f1152f`) and its
four-file documentation follow-up PR #36 (`a4da4b0f`). The later documentation-only
commit `21bc4fe9` and its Step 76 access record are also retained. This is not a
production deployment and does not replace the user's full pre-release acceptance.

Both implementations are retained: shared voice recording, abortable/retryable
attachments, stale-writer protection in atomic encrypted storage, realtime
revocation and fail-closed maintenance from PR #35; stricter storage durability,
post-Hide unpublished voice cancellation, conversation-list batching, accessible
zoom/contrast, PWA shell refresh and paired DB/native-browser gates from PR #34.
A reproduced delayed-scroll/resize race is also fixed with unchanged assertions.

The reconciled code passes local 35-case component/browser acceptance, 10 repeated
anchor scenarios, 24 domain tests, 23 lifecycle/storage/receipt tests, 8 maintenance
fault tests, four release-script checks, TypeScript, lint (0 errors / 14 warnings),
and the production build/bundle budget. These are not the pending exact-head full
CI or native IndexedDB/PostgreSQL job results. See [the behavioral evidence](audits/behavioral-hardening-2026-09-22.md).

## Completed upstream baseline (not verification of PR #34)

| Evidence | Exact identity / result |
| --- | --- |
| Audit PR | #35, squash-merged after user approval |
| Audited PR head | `4aea0f4888a4ed86028afacab0df4d973e1a6670` |
| Full PR gate | CI #311 / `35702589645`, completed / success |
| Upstream application commit | `24f1152f24e5f9d661866ce30ffafe3ce550cd33` |
| Upstream application tree | `3b87cc0aeb7e7d8e43a2fc8900d143ecbaa8cf64` |
| Post-merge gate | CI #313 / `35705703951`; evidence in [Step 75](steps/75-audit-merge-verification.md) |
| Documentation-only follow-up | PR #36 / `a4da4b0f981fc9b31ad84be53f8fa548b7f47489` |
| Production and real-device acceptance | Not performed by this step |

Earlier progress is preserved byte-for-byte in [the upstream historical checkpoint](audits/progress-before-pr35-merge-2026-09-22.md).
The upstream implementation and client-profile evidence remain in [its audit](audits/predeployment-2026-09-22.md).
Any statement in historical documents about fixed/no-pinch viewport or only the
next deployment being outstanding is superseded for PR #34 by the active review.

Step 76 records a separately authorized deployment of the upstream application
`24f1152f`, blocked before server changes by authenticated execution access.
That record is preserved in [the access handoff](steps/76-deployment-access.md);
it does not certify or authorize deployment of this unmerged PR #34 candidate.

## Remaining release boundary

Require successful `ci` and `hardening-behavior` for the exact reconciled SHA,
review of the combined changes and a separately checked merge gate. Do not use
CI #308/#310/#313 or the intentionally failing test-only checkpoint as evidence
that new application changes are ready.

The complete user-defined review remains open: manual WCAG/assistive-technology
acceptance, physical iOS/Android installed PWAs and real-device direct/group MLS,
account/key recovery, larger/longer workload and memory evidence, staging
migrations/deployment/rollback/backup restoration with agreed RPO/RTO, and alert
delivery. The license inventory's unknown entries/infrastructure coverage also
remain a review item, not a complete license-compliance claim.

No new product feature scope is opened. Production deployment and production
smoke require a separate explicit instruction. The historical live SHA `68211e02`
does not identify the running release. Follow [the production runbook](PRODUCTION.md)
and [Step 70](steps/70-live-verification.md) when those steps are authorized.

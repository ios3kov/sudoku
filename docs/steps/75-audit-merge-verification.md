# Step 75 — audited candidate merge and verification

Date: 2026-09-22.

## Scope and acceptance

Continue the completed pre-deployment audit by merging the reviewed PR, verifying the exact post-merge candidate, updating the release documentation and reporting status. The user authorized this continuation; production deployment and the deferred live/physical Step 70 were not authorized by it.

Acceptance: unchanged audited head before merge; completed successful PR CI; merge guarded by expected head SHA; merged source tree identical to the audited tree; completed successful post-merge CI for the exact application commit; current, traceable documentation; no production mutation. A pending, failed, cancelled or mismatched run is not a pass.

No new feature, blanket refactor, dependency, schema change, runtime patch or weakened assertion is in scope. A newly reproduced blocker would require diagnosis, its own correction and verification rather than reuse of this gate.

## Execution record

1. Read PR #35, its final review, CI #311 and individual job steps through the connected GitHub API. PR head remained `4aea0f4888a4ed86028afacab0df4d973e1a6670`; main remained `ec557c2827b0d2b5329425016df3dfa8ddaf4f71`. No outstanding blocking review was present in the retrieved discussion.
2. Read `.github/workflows/ci.yml` and the workflow directory. The only tracked workflow runs tests/builds on pull requests and main pushes; it contains no production deploy step. No SSH, deployment, restart, secret change or real restore was performed.
3. Squash-merged PR #35 with the exact expected-head guard. GitHub returned application commit `24f1152f24e5f9d661866ce30ffafe3ce550cd33` at `2026-09-22T08:36:07Z`.
4. Verified that the merged source tree is `3b87cc0aeb7e7d8e43a2fc8900d143ecbaa8cf64`, exactly the same as the reviewed PR tree. A new main-push run, CI #313, was created for this application SHA, not for an earlier candidate.
5. Post-merge result: **completed / success**. Details and the explicit release boundary are recorded below.

## Exact verification evidence

| Gate | SHA | Run / job | Result |
| --- | --- | --- | --- |
| PR #35 | `4aea0f4888a4ed86028afacab0df4d973e1a6670` | CI #311 / `35702589645` / `106663867818` | completed / success |
| Main application candidate | `24f1152f24e5f9d661866ce30ffafe3ce550cd33` | CI #313 / `35705703951` / `106673966483` | completed / success |

- [PR and final audit review](https://github.com/ios3kov/sudoku/pull/35)
- [Full PR run](https://github.com/ios3kov/sudoku/actions/runs/35702589645)
- [Post-merge run](https://github.com/ios3kov/sudoku/actions/runs/35705703951)
- [Post-merge job](https://github.com/ios3kov/sudoku/actions/runs/35705703951/job/106673966483)

The exact main-push run is completed / success (GitHub run updated at `2026-09-22T08:47:51Z`, attempt 1). All required steps passed: Python lint/audit, migrations/API integration, pinned OpenMLS tests/build and Rust audit, npm audit, web lint/domain/refresh/lifecycle/storage/maintenance regressions, TypeScript, production web build/budget, browser E2E, operation-script checks, MinIO images, Compose validation and final production API/Web image builds. Post-job cleanup also succeeded. Failure-evidence upload alone was correctly skipped. The exact application post-merge gate is closed; this is not a deployment or physical-device acceptance.

Execution evidence in this step comes from GitHub Actions. No new local full application suite, physical-device run, independent pentest, load/soak test or live restore is claimed. The existing audit's local results and bounded measurements remain historical evidence on the unchanged application source.

## Documentation review

The current [progress index](../PROGRESS.md) replaces conflicting old release-status paragraphs. Its previous content is preserved without alteration as [a historical checkpoint](../audits/progress-before-pr35-merge-2026-09-22.md). [The production runbook](../PRODUCTION.md) identifies the new application candidate while retaining the distinction from actual deployment evidence. The original [audit](../audits/predeployment-2026-09-22.md) retains its measured results and limitations.

Documentation is isolated from the application candidate. A documentation-only follow-up must be reviewed for Markdown/link/identity consistency and compared with `24f1152f24e5f9d661866ce30ffafe3ce550cd33` to confirm that no application, tests, dependencies, build, workflow or infrastructure files changed. A skipped duplicate full suite for a Markdown-only commit is not represented as a new CI pass. The exact application run above remains the release evidence; no existing application gate is removed or weakened.

## Handoff and stop conditions

The exact application post-merge gate is closed on `24f1152f24e5f9d661866ce30ffafe3ce550cd33`. The next application action is a separately authorized deployment of that verified candidate, not another global audit or feature phase. Any later application, dependency, workflow, build or infrastructure change requires its own reviewed exact-SHA gate. Stop deployment on a missing/mismatched identity, failed preflight, failed live smoke or a newly reproduced security/storage/recovery blocker.

Production remains unchanged by this step. After explicit deployment authorization, use the verified application SHA rather than an arbitrary moving main ref, run preflight, record deployed identity, then execute live smoke. Do not infer deployment from a merge, a Docker build or a successful CI run.

[Live/physical Step 70](70-live-verification.md) remains separately open: real worker fanout, two-device direct/group/invite/attachment/voice/revocation flows, installed iOS and Android PWA behavior, persistence and a controlled actual restore. Known snapshot-write, multi-tab, viewport, CSP and maintenance-warning limitations remain in the audit and progress index. There is no new product scope and no justification to reopen the same global audit without a new defect or source change.

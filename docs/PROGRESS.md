# Progress

## Current milestone — confirmed beat runtime blocker

Snapshot: 2026-09-22. Deployment is authorized, and the operator has restored SSH access. The assistant still has no authenticated host shell. [Step76](steps/76-deployment-access.md) records the earlier access checkpoint; it no longer describes the operator's access status.

The operator's live logs confirm [issue #38](https://github.com/ios3kov/sudoku/issues/38): Celery beat cannot write its default schedule file in root-owned `/srv/api` while running as non-root `sudoku`. It has restarted 2,154 times. API readiness alone did not detect this. Operator checkout is `33f17fe` with no reported tracked changes; that is not an image-to-source attestation. No new production deployment has been verified.

[Step77](steps/77-beat-state-directory.md) specifies and implements the narrow fix: private owned scheduler directory, explicit schedule path, persistent beat-only named volume, and actual non-root scheduler Docker runtime regression. It records local red/green evidence, CI requirements and deployment cautions. Exact remote run/SHA results are tracked in the fix PR and issue #38; pending checks must not be counted as success.

## Release identities and gates

| Checkpoint | Identity / meaning |
| --- | --- |
| Historical audited application | PR #35, `24f1152f24e5f9d661866ce30ffafe3ce550cd33` |
| Historical full PR / main gates | CI311 and CI313 passed; [Step75](steps/75-audit-merge-verification.md) |
| Newly discovered limit | That candidate still contains the beat startup defect; do not deploy it unchanged |
| Corrected candidate | `fix/beat-state-directory`; exact reviewed and verified SHA is recorded in its PR |
| Required automated gates | Existing full `ci` plus new `beat-runtime`, each on exact PR and merged application SHA |
| Production | Authorized, not newly deployed or live-verified; operator preflight/backup/rollout still required |
| Issue38 closure | Actual deployed beat stability and worker processing evidence, not CI alone |
| Live/physical Step70 | Still separately open and deferred |

No further deployment confirmation is needed. Do not run a destructive restore, change firewall rules or expose secrets as a shortcut. The old formally live-verified SHA `68211e02` is historical and does not establish the current running images.

## Implemented product and retained audit evidence

Messenger UX3 and PR35 audit corrections remain included: media/voice teardown and retry, immediate concealment and session revocation, atomic encrypted storage with stale-writer rejection, fail-closed restore handling, authorized history batching, timestamp-rendering optimization and the supplied messenger design with 50% whole-screen Sudoku reveal.

Encrypted direct/group messaging, attachments, persistent encrypted protocol state/outbox, reload/reconnect recovery and membership/rekey remain subject to full regression CI. Implementation/measurements and limits are in [the predeployment audit](audits/predeployment-2026-09-22.md). Earlier progress is preserved in [the historical archive](audits/progress-before-pr35-merge-2026-09-22.md).

Retained risks: large encrypted-snapshot write amplification, reload-required multi-tab conflicts, fixed-viewport/no-pinch accessibility tradeoff, inline-script CSP architecture and existing ESLint/Rust maintenance warnings. No formal cryptographic proof, independent pentest, complete WCAG certification or physical-device performance pass is claimed.

## Next release boundary

Complete exact-head and post-merge gates for the corrected candidate. Then follow [Step77](steps/77-beat-state-directory.md) and [the production runbook](PRODUCTION.md): retain actual rollback image identities, preflight and backup without prematurely replacing image tags, deploy the corrected image/Compose together, and capture running identity, stable scheduler, worker success and live smoke. Stop on any failed safety gate. The tracked GitHub workflows build/test only; they do not deploy Selectel.

[Step70](steps/70-live-verification.md) remains separate: real worker fanout/two-device encrypted flows, invites, installed iOS/Android PWA background/push/keyboard/voice, restart/reboot persistence and a controlled PostgreSQL plus encrypted-object restore drill. Do not label the service production-verified until the applicable live acceptance is completed.

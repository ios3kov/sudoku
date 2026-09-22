# Step 76 — deployment authorized; access blocked

Date: 2026-09-22. Status: **BLOCKED BEFORE PRODUCTION CHANGES**.

## Scope and authorization

The user explicitly authorized deployment of application commit `24f1152f24e5f9d661866ce30ffafe3ce550cd33` after Step 75. Normal preflight, backup, deployment, smoke and documentation are authorized; another deployment confirmation is not the missing prerequisite. Destructive restore, physical-device acceptance and the rest of deferred Step 70 remain separate.

The application candidate is unchanged. GitHub job `106673966483` in [CI #313](https://github.com/ios3kov/sudoku/actions/runs/35705703951) was re-read and is completed/success, including all required steps and cleanup; failure-evidence upload alone was skipped. The repository main ref before this documentation follow-up is `a4da4b0f981fc9b31ad84be53f8fa548b7f47489` (Step 75 documentation).

## Access observations

- The current execution environment is an isolated Linux environment, not the administrator's Mac. It has no `~/.ssh/sudoku_selectel` key, configured SSH agent or SSH client in PATH.
- A TCP/22 probe from this environment returned `ConnectionRefusedError`. HTTPS probes from this environment failed DNS resolution. These observations concern this execution path; they do not establish that the production server is down or that its firewall has changed.
- A read-only attempt through the connected browser profile reached the Selectel login/SSO page rather than an authenticated control panel. No usable authenticated console was established. No credentials were requested, reset, guessed, added or published.
- Available integration discovery did not expose an authenticated server shell. GitHub access is working, but repository access is not server access.

## What did not run

No authenticated host inspection, host preflight, production backup, checkout, build, restart, deployment or live smoke ran in this step. Running release identity and rollback readiness remain unverified. No production configuration, firewall, secrets, application data or services were changed by this step. No deployment-success or production-readiness claim is made.

## Resume from the authorized administrator workstation

The known administrator key is local to the Mac. Open an authenticated shell from that workstation without copying its private key or passphrase into chat:

```bash
ssh -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -i ~/.ssh/sudoku_selectel deploy@185.31.167.36
```

This command only opens a shell; it does not deploy and it does not connect this chat to that shell. Keep host-key checking enabled. A host-key mismatch or access failure is a stop condition, not a reason to widen the firewall or disable authentication.

From an authenticated execution environment, follow the [production runbook](../PRODUCTION.md): inspect the actual current checkout and running image identities, preserve rollback evidence, complete preflight and a successful backup, deploy the exact verified candidate, then record running identity and live smoke. A failed backup/preflight blocks updating the application. Do not perform an automatic database downgrade or a destructive restore. Keep credentials, backup archives and raw private logs out of Git.

## Verification and handoff

This follow-up changes documentation only. The shell connection command was syntax-checked locally; it was not executed successfully against production. Markdown structure and exact candidate identity were checked. Application code, tests, dependencies, workflow and infrastructure configuration are unchanged; no new full application CI pass is claimed for the documentation commit.

The immediate blocker is authenticated execution access, not authorization or a failed application test. [Step 70](70-live-verification.md) remains open and deferred. [Step 75](75-audit-merge-verification.md) retains the exact successful application gate.

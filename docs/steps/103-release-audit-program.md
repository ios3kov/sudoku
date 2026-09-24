# Step 103 — release audit and polish program

Approved by the operator on 2026-09-24. Baseline: main `a8001ceb4bb292a334e0359c78bb6fa624687b83`, after PRs #83 and #84. This program coordinates release validation; its approval does not authorize production deployment, migrations, TestFlight or App Store publication.

## Ordered delivery

1. **Physical functional acceptance:** two iPhones and two test accounts. Verify icon/cold launch, public game, ordinary digit 5 versus hold-and-drag reveal, phone login/PIN, direct/group messaging, voice/photo/video/file exchange, background privacy, keyboard, offline/reconnect, retries without duplicates, history recovery and session revocation. Record device/OS, native and web SHA, server version and evidence for each result.
2. **Technical and security audit:** review authentication/authorization, contact and invitation ACLs, MLS lifecycle and recovery, ciphertext-only attachments, upload/download access, data retention, logging, dependency risks, backup/restore and operational configuration. Inventory existing evidence before repeating tests. A destructive restore drill uses an isolated environment.
3. **UX/UI audit:** walk every public and private flow, navigation, gestures, keyboard, empty/loading/error states, permissions and recovery. Review consistency, legibility and VoiceOver. Maximum-text changes are closed by operator decision and are not reopened by this program.
4. **Performance profiling:** use physical devices and representative synthetic histories/media to measure cold/warm launch, gesture/scroll hitches, main-thread work, memory growth, CPU, thermal/energy impact, network requests and media processing/playback. Use Instruments and browser tooling where appropriate. Record build mode, device, workload and repeated measurements; set workload-specific budgets from the baseline before optimization. This is one profiling workstream, not separate duplicate audits.
5. **Targeted fixes and polish:** prioritize security/data loss, then reliability/performance, then usability/visual consistency. Refactor only demonstrated causes of defects or material complexity; preserve behavior with focused regression coverage. No wholesale rewrite is assumed.
6. **Final candidate verification:** repeat affected checks, run full required CI on the exact candidate, review the final diff, complete physical/two-device and recovery evidence, and record accepted residual risks before requesting release authorization.

Independent read-only preparation may proceed while devices or a test environment are unavailable. Missing physical evidence never becomes a pass through elapsed time or automated CI.

## Findings register

Each finding records: identifier, severity, affected flow, reproduction, source/build/environment, observed versus expected result, evidence, proposed correction, owner/status, verification and PR. Statuses: open, in progress, fixed awaiting verification, verified, accepted limitation. Critical security/data-loss findings block release; high-severity findings require correction or an explicit documented operator decision.

The working register is [the baseline audit](../audits/release-baseline-2026-09-24.md). Archive historical claims as historical; never overwrite them with unsupported acceptance.

## Scope decisions

- PR #83 merged as `6ed009061ebf571c8078875ea230caee30fff33d`; further maximum-text adaptation is closed by operator decision, not a claim of complete accessibility testing.
- PR #84 merged as `a8001ceb4bb292a334e0359c78bb6fa624687b83` after all five applicable checks passed; it supplies the selected application icon.
- VoiceOver, full physical-device acceptance and two-device E2EE remain separate open gates.
- Portrait-only application, with landscape permitted only for horizontal-video playback, remains the product contract.

## Entry prerequisites

The offline Sudoku QA harness serves bundled UI and explicitly rejects `/v1/` requests with 401; it cannot validate real sign-in, native account bridges or messaging. The native production host loads `https://sudoku.moscow/`, so installing a new native build alone does not update its web/backend version. Prepare an isolated reachable test environment for the candidate, with synthetic accounts/data and explicit version records, before claiming end-to-end acceptance of unreleased changes. Production rollout remains separately authorized.

# Consolidated release audit — 2026-09-24

## Decision and evidence boundary

Repository baseline: `f7ba8fce00b251bbeedc1fdd89a6657cfdb2e0c9` (PR #87). This report consolidates the approved [Step103](../steps/103-release-audit-program.md) and the [findings register](release-baseline-2026-09-24.md). The current audit candidate also contains request-log regression coverage, an export-boundary trace privacy fix, and reproducible performance evidence collection. Exact candidate CI and measurement results are attached to the audit PR; a pending job is not a pass.

This is a repository audit with controlled runtime evidence. It does not certify a live deployment, cryptography, all possible vulnerabilities, physical accessibility or disaster recovery. Production is not changed. Further maximum-text changes remain closed by the operator, without implying VoiceOver acceptance.

## Coverage and outcome

| Area | Reviewed source and automated evidence | Outcome / remaining boundary |
| --- | --- | --- |
| Authentication and authorization | Cookie session hash/expiry/revocation; device PIN capability; row-locked rotation; admin-only invitations with phone binding; contact-scoped directory; group owner/member guards. API device-access, phone/contact, core-flow and MLS membership regressions. | Existing guards retained; no new bypass demonstrated. Physical biometric/revocation acceptance remains open. |
| MLS and durable messaging | Existing OpenMLS interop, persisted encrypted state, pending membership exclusion, device rekey, offline outbox, duplicate acceptance, session revocation, query-budget and recovery tests. | No protocol rewrite. Automated coverage is not an independent cryptographic assessment. Large encrypted snapshot persistence and multi-tab fail-closed conflicts remain known constraints. |
| Media and retention | Signed conditional creation, bounded integrity reads/downloads, stalled PUT recovery, encrypted screen-lifetime cancellation; photo/voice/video preparation and teardown tests. Orphans are selected after 24h in batches and object deletion precedes row deletion. | REL-006–010 fixed and verified in preceding PRs. Linked media has no newly introduced automatic deletion. Provider migration, quotas/tiering and physical quality acceptance remain open. |
| Log and trace privacy | Four real ASGI request-middleware tests; installed FastAPI OpenTelemetry instrumentation reproduction; trace export regression with synthetic URLs, query, database statements, exception details and custom metadata. | Request logs passed. REL-011: raw query values entered trace export. Candidate allowlists exported diagnostics and drops raw names/events/links/status descriptions. Existing historical traces are not retroactively scrubbed. |
| UX/UI and accessibility | Public game/startup/save/reveal, named controls, narrow layouts, keyboard/focus/dialogs, reduced motion, scrolling/read states, media states and privacy concealment have browser scenarios. Selected controlled-chat screenshots are retained with profiles. | Current browser suite is required. VoiceOver and real keyboard/background behavior are not certified by Chromium. No redesign or reopening of the maximum-text decision. |
| Performance | Bundle/WASM budget and 100/200-row query-budget tests; three fresh Chromium component-profile runs, 4x CPU slowdown, 140/5,000-message histories, 30 inputs each, 12 hide/show cycles. Raw JSON and screenshots retained with source SHA/runtime metadata. | Synthetic runner baseline, not physical FPS, field INP, energy/thermal or full MLS catch-up timings. Earlier 2026-09-22 numbers are historical, not a current comparison on identical hardware. |
| iOS boundary | Trusted HTTPS host/main-frame checks, privacy cover on resign-active/background, passcode-bound Secure Enclave biometric key with current-biometry policy; portrait shell/video-only landscape; native media bounds and cancellation. | Source review plus earlier native CI. No fresh physical two-account or VoiceOver acceptance. New web/API candidate is not delivered by merely rebuilding the production-origin native shell. |
| Operations and recovery | Non-root runtime and capability restrictions; private MinIO, explicit production origin/E2EE gate; backup manifest/checksums and exclusive maintenance lock; restore stops writers and leaves failure offline; Linux fault injection and pinned images in CI. Candidate also dumps the disposable CI PostgreSQL database, restores to a separate database and copies synthetic backed-up objects to a separate pinned-MinIO bucket. | Restore evidence includes table counts, migration version, object hashes/metadata and decryption of a synthetic AES-GCM probe. Execution result is retained in `restore.json`; until that exists and passes, no runtime result is claimed. Full post-restore application login, off-host backup verification and server hardening remain open. |
| Dependencies/build/refactoring | Python/Node/Rust audits, production builds, schema upgrade regressions, lint/typecheck, UI contract and browser acceptance are CI gates. | No speculative rewrite. Known Rust maintenance warnings remain distinct from vulnerabilities. Any new CI failure blocks acceptance of this candidate. |

## REL-011 — trace export privacy

Reproduction with installed FastAPI instrumentation `0.65b0` and SDK `1.44.0`: a synthetic `GET /v1/contacts?q=...` put the query value into exported trace attributes. The application permits an external OTLP endpoint, so its safe request logger did not protect this separate diagnostic channel. No real private data or live collector was accessed; production exposure is not asserted.

`PrivateSpanExporter` wraps the configured OTLP span exporter. It copies spans into a restricted representation, preserving trace/parent identity, timestamps, kind, error code, configured service identity, route template/method/status and database system metadata. It omits full URLs, SQL/Redis text, captured headers, custom names, exception events, links, instrumentation metadata and status descriptions. The source spans are not mutated. Less detail is deliberately available in external trace diagnostics; timing and correlation remain. Metric export and all third-party logging are separate boundaries, not covered by this span filter.

Primary reference: [OpenTelemetry FastAPI instrumentation](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html). The fix is verified against actual installed instrumentation and an in-memory exporter, rather than inferred from documentation alone.

## Release blockers and remaining work

1. **Candidate environment and physical cross-client acceptance:** bind native/web/API versions; verify real iPhone plus desktop accounts for direct/group media, recovery, revocation, background privacy and keyboard. Offline Sudoku QA cannot provide this evidence.
2. **Physical VoiceOver and media quality:** inspect focus/announcements and actual microphone/photo/video playback with the candidate. Maximum-text work remains intentionally closed.
3. **Device performance:** Instruments CPU/memory/energy/thermal and cold/warm launch; real encrypted histories/media. CI profiles provide a repeatable fixture baseline only.
4. **Recovery acceptance beyond the CI drill:** start the full application against restored data, verify login/messages and production-sized RTO/RPO; verify encrypted independent backups and key-recovery limitations. The CI dump/restore roundtrip is a separate, limited evidence layer. No production restore is authorized.
5. **Deployment-specific privacy/configuration:** inspect applied CORS, TLS, backup schedules, retention and collector configuration before release; broader third-party log/metric payload policy remains an explicit operational review item.
6. **Storage expansion:** Russian-region provider procurement, network tests, copy/verify/rollback, quotas and monitoring remain planned in Step95. Do not interpret documentation or this audit as provisioning/migration permission.

These items are not closed by the passage of time or by CI. The audit records them as release blockers/evidence gaps; it must not report the entire production acceptance program as complete while they remain.

## Compatibility and scope decisions

The legacy plaintext upload route remains present for compatibility; ciphertext-only storage cannot be claimed for all possible API clients while that route is enabled. New encrypted conversations validate encrypted attachment use, and production configuration requires E2EE for new conversations. Before a strict ciphertext-only provider rollout, explicitly resolve legacy endpoint/data policy rather than silently deleting existing data.

`THIRD_PARTY_NOTICES.md` retains the adapted Sudoku generator's MIT notice. Public gameplay remains available without messenger authentication; the remembered startup flag is not an authorization capability. Generic push text does not contain messages or sender names. These are source-reviewed properties, not store approval or a legal compliance certification.

The CI recovery drill uses only disposable services and randomized destination names. Its backup files are temporary and never uploaded as artifacts; only counts, sizes, source SHA and elapsed time are retained. No encryption keys, database dumps or object content are included in published audit measurements.

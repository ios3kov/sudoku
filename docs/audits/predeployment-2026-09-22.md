# Pre-deployment global audit — Sudoku messenger 1.0

Date: 2026-09-22. Baseline application: `ec557c2827b0d2b5329425016df3dfa8ddaf4f71`, tree `b8e913dd49e735200ad60cc88b63fb9cd042c174`.

## Mandate, specification and release boundary

The user explicitly requested a new global technical/security, UX/UI, polish and performance audit before deployment. This reopens the release-candidate gate; historical CI #286 does **not** verify this new patch. No production deployment, server configuration change, real database restore, new product feature or redesign is authorized by this audit.

Preserve the supplied Minimal Messenger presentation, 50% Sudoku reveal, privacy unmount, account/chat draft separation, transport ordering, fail-closed encryption, persistent encrypted outbox, authorization and the pinned OpenMLS protocol. Success means reproduced problems have regression coverage, measured improvements are reproducible, and the exact corrected candidate passes the full automated gate. Physical-device and operational acceptance remain independent.

Work order: baseline characterization; lifecycle/security and operation-script fault injection; scoped implementation/refactor; actual-component mobile/performance measurement; separate review; all available checks; a new PR with full integrated CI. Stop on a failed security/storage/recovery, type, lint-error, build, performance-budget or browser gate. Never convert a pending check to a pass or loosen an assertion to conceal a product failure.

## Architecture and scope map

| Boundary | Audit work / evidence |
| --- | --- |
| Public Sudoku and private account surface | Existing reveal/mobile scenario retained; actual chat Back/Hide lifecycle tested. No gesture changes. |
| React chat, drafts, actions, timeline | Existing UX3 scenarios repeated, new 320/390/landscape/tablet checks, focus/Escape/reduced motion, long text, composer and hit targets. |
| Media, voice and browser resources | Actual view/attachment components with controlled late permissions, network/recorder failures, blob URL and track accounting. |
| Local protocol storage | Real AES-GCM with deterministic IndexedDB transaction scheduler; real-origin native IndexedDB tests added to full browser CI. |
| MLS/API/transport/authorization | Protocol/wire payload unchanged; bulk payload retrieval remains below the authorized feed; existing API/OpenMLS/reload/offline/rekey tests required. |
| Session/realtime | Source-level endpoint and real-client tests for server revocation, malformed frames, stopped sockets, detached handlers and immediate UI concealment. |
| Backup/restore and containers | Fault-injected scripts with a fake Docker executable; existing preflight/Compose/non-root/image gates retained. No real restore run. |
| CPU, memory and bundle | Chromium actual-component CDP profile, 4x CPU slowdown, 140/5,000-item history, 30 input samples each, hide/show cycles, production bundle budget. |

## Findings and corrections

Severity here is release triage, not an external vulnerability score.

| ID / priority | Reproduced problem | Correction / regression |
| --- | --- | --- |
| A01 / P1 privacy | A microphone permission result arriving after Hide starts a recorder/retains a live track. Duplicate activations and constructor failures also lose resource ownership. | Shared `useVoiceRecorder`: synchronous ownership, cancellable session token, cleanup of late streams, timers and handlers. Initial behavioral reproductions failed; corrected tests pass. |
| A02 / P1 privacy | Transport failure disables Stop during a recording; recorder error can upload partial audio. | Stop stays actionable while recording, failed recording is discarded, encrypted upload refuses blocked sync. Normal recording still sends exactly once. Remove scale from the pulse animation so Stop remains stable/clickable. |
| A03 / P1 privacy | A decrypted download completing after unmount creates/retains a plaintext blob URL. Voice errors become unhandled rejections and cannot be retried. | Abortable single flight plus generation/mount checks after async decrypt; release URL/File/timer on hide/offscreen; generic retry UI and caught errors. WebCrypto completion is guarded because aborting fetch alone is insufficient. |
| A04 / P1 session | Server-to-client WebSocket forwarding trusts client pings for revocation, so a silent revoked client can continue receiving events. UI concealment waits behind potentially stalled IndexedDB cleanup. | Revalidate session before each outbound event and on receive-idle deadline; failed auth/forwarding closes connection. UI hides synchronously; protocol/outbox cleanup runs separately. |
| A05 / P2 robustness | Non-object JSON and object-valued event types crash the socket handler. Retired browser sockets can install timers/forward stale events. | Validate object/string shape and bound application-frame characters; retire/detach socket callbacks and make start idempotent. Existing valid delivery/reconnect controls pass. |
| A06 / P1 data integrity | Concurrent initializers overwrite the shared wrapping key, making earlier encrypted state undecryptable. A request success is acknowledged even if its transaction subsequently aborts. | Generate outside IDB transaction; atomically recheck/insert within one serialized readwrite transaction; resolve only on transaction completion. Keep key nonextractable and existing database/ciphertext format. |
| A07 / P1 data integrity | A stale adapter can overwrite a newer same-state ratchet/outbox snapshot or resurrect state after revocation. | Compare observed ciphertext and current record inside the write transaction; reject conflicts with a reload-required error. Closing a store ID prevents late local writes. This is fail-closed conflict detection, **not** simultaneous multi-tab MLS reconciliation. |
| A08 / P1 operations | Failed database/object restore restarts applications with a partially restored pair; missing/unlisted objects and restart failures can pass too far. | Validate complete inventory before service changes; exclusive maintenance lock; transactional/exit-on-error pg_restore; bounded object-store readiness; failure leaves apps stopped; restart failures are nonzero. Eight fake-Docker fault/success tests pass. |
| A09 / P2 performance | History catch-up performs one payload SQL query per transport row. | At most two payload queries per page, using only already-authorized IDs and conversation match; preserve original output order. 100/200-row query-budget tests fail before/pass after. |
| A10 / P2 UX/performance | Every draft keystroke reformats timestamps for the visible history. Small controls and pale metadata reduce mobile usability. | Memoize unchanged timestamp formatting, retain receipt updates; 44px main chat controls; darker incoming timestamps/subtitle and white own-message metadata. Profile and four-viewport tests below. |

The media refactor removes duplicated recorder state/cleanup logic from encrypted and legacy conversation views; protocol-specific upload/send behavior stays in those views. Realtime retirement and state-store transaction helpers each own one well-defined boundary. No blanket API/MLS rewrite, added dependency, schema migration, skipped acceptance or production test observer.

## Actual measurements

`BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/profile-messenger.mjs <output.json>` compiles the actual timeline/draft/action components with the pinned project toolchain and runs managed Chromium via `setContent`. CDP uses CPU slowdown 4x; viewport 390x844; 30 input events after warmup. “Before” is the audit working source **before timestamp memoization**, not a claim that every other audit correction was absent. Same engine/fixture/settings are used after.

| Measure | Before | After |
| --- | ---: | ---: |
| Main-thread task time/input, 140 history messages | 65.53 ms | 20.44 ms |
| Main-thread task time/input, 5,000 history messages | 59.00 ms | 19.48 ms |
| Script time/input, 5,000 history messages | 44.60 ms | 7.78 ms |
| Input-to-two-frames p95, 5,000 history messages | 80.40 ms | 32.60 ms |
| Rendered rows at either history size | 120 | 120 |

These are fixture/runtime measurements, **not** field INP, Lighthouse scores, real-device FPS or full encrypted catch-up latency. Two-frame latency includes display scheduling. Default tail rendering stays 120; explicitly loading earlier history can increase visibleCount, so no claim of a permanent 120-row cap is made.

After 12 hide/show cycles and forced diagnostic GC: hidden heap 4,081,012 -> 3,774,044 bytes, remaining history nodes zero. This bounded observation found no growth; it does not prove absence of all leaks. Media resource counters test the late-completion risks separately.

Transport test: a mixed 200-event page goes from **200 payload lookups to 2**. Authorization/feed queries are unchanged; this is a query-count bound, **not** an asserted 100x latency improvement. PostgreSQL integration and authorization remain full-CI gates.

Production budget: 10 JS chunks, total gzip **215,962 bytes** (prior 214,872; +1,090), largest chunk 71,470; pinned WASM 2,709,987 raw; service worker 2,546. Budget passes. Raw measurement JSON is in `docs/audits/evidence/predeploy-2026-09-22/`.

## Verification actually executed locally

- Exact baseline source tree checked against GitHub; dependencies/prebuilt WASM restored from earlier pinned repository artifacts. No new npm installation/Rust compilation claimed locally.
- Domain: **24/24**; refresh/receipt/client/concealment/storage Node regressions: **23/23**.
- UI contract: **7/7**, 149 classes.
- Actual-component/selector/mobile browser checks: **25/25**, zero retries. Four actual-chat viewports include 320x568, 390x844, 844x390, 768x1024; visual screenshots of chat/action dialog inspected.
- Endpoint body + actual SQLAlchemy query characterization: **8/8** via controlled source-loading harness, because local Redis/Celery dependencies are unavailable. Committed tests import normal production modules in full CI. Not a local full API/PostgreSQL run.
- Maintenance scripts: **8/8**, fake Docker, no real service mutation.
- Web TypeScript, production Next build, bundle budget, Python compileall and Bash syntax pass.
- ESLint: **0 errors / 14 warnings**, down from 17. Remaining warnings are existing effect/hoisting/unused-symbol debt outside these changed lifecycles, not ignored errors. No rule was weakened.
- Two additional native IndexedDB browser scenarios and existing full MLS/Sudoku service-backed scenarios await integrated CI. Their discovery/typecheck is not counted as an execution pass.

Red/green evidence includes: 7 original media failures; 3 retired-socket failures; 3 provisional/atomic-storage failures and 2 stale-writer failures; 6 operation-script failures; malformed/revoked socket cases; 100/200-row query-budget failures. Initial test-fixture mistakes (accessible name/pseudo-content, numeric subpixel rounding, an almost-zero reduced-motion duration) were corrected against rendered semantics, not classified as product bugs. Long-press/swipe/reload/offline and duplicate accepted-message checks remain intact.

## Separate review and residual boundaries

Reviewed changed interfaces/callers, async callbacks after teardown, normal/error voice paths, retry ownership, IDB transaction sequencing and conflicts, ciphertext format compatibility, query authorization/order, fail-closed restore ordering, unchanged deployment/gesture policy, CSS scope and test-only bundles. Generated Next configuration/type files and local tools/logs are excluded from the patch.

Remaining release requirements: exact corrected SHA's full CI; deployment only on a later explicit command; real worker fanout/two-device direct+group acceptance, physical iOS/Android installed-PWA background/keyboard/push/voice checks, persistence and a controlled restore drill. These are not waived by this audit.

Known limits retained rather than disguised as passes: full protocol history is persisted as an encrypted snapshot (large histories still require physical-device write-amplification profiling); default rendered window can grow on explicit earlier loading; strict power-loss durability is not certified by transaction-complete tests; multi-tab concurrent edits now fail closed and require reload, rather than seamlessly merge; prior fixed-viewport/no-pinch requirement remains an accessibility tradeoff; existing inline-script CSP architecture and transitive Rust maintenance warning remain documented baseline risks. No independent penetration test, cryptographic proof, complete WCAG certification or real backup restoration is claimed.

## Primary references used during review

- React cleanup/Strict Mode: https://react.dev/reference/react/useEffect
- getUserMedia async permission lifecycle: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- IndexedDB transactions/commit: https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction
- WebSocket session validation: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- PostgreSQL restore transaction/errors: https://www.postgresql.org/docs/current/app-pgrestore.html
- Locale-formatting cost: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleTimeString

## Handoff / gate

Implementation and local checks above are complete at this checkpoint. Record exact PR SHA, full CI result and final review in the PR before merging. Do not reuse the original candidate's green CI or the old live-edge smoke as evidence for this changed application. `main` and the production service are unchanged by this local checkpoint.

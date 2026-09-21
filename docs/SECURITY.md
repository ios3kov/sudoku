# Security

## Threat model

Protect against unauthorized access after discovery of the hidden gesture, session theft, conversation IDOR, CSRF/cross-site WebSocket hijacking, brute force, API abuse, malicious uploads, duplicate/replayed messages, push/URL leakage and unbounded orphan storage.

## Authentication and authorization

- Argon2id passwords.
- Opaque random sessions; only SHA-256 session-token digests are persisted.
- Secure, HttpOnly, SameSite=Lax cookie.
- Rotatable/revocable per-device sessions.
- Invite-only account creation. Invite secrets are submitted in JSON request bodies and never placed in request URLs.
- Only `is_admin` users can issue/revoke invites.
- First administrator is created by an explicit bootstrap CLI; the password is read from a hidden prompt, not argv.
- Every conversation/message/asset path performs server-side membership/ownership checks.
- Group administration uses conversation-local owner roles; a global app admin does not bypass group membership authorization.
- The last group owner cannot be demoted/removed, preventing ownerless groups.
- Active device sessions are user-visible and remotely revocable. A remotely revoked browser session is concealed immediately when the authenticated realtime channel closes, local MLS state/outbox are cleared, and the UI returns to Sudoku.

## Browser request boundaries

- State-changing HTTP methods reject mismatched `Origin`.
- Cookie-authenticated WebSocket connections require exact `PUBLIC_ORIGIN` before authentication/accept.
- Private `/v1/*` responses are never cached by the service worker and the API adds `Cache-Control: no-store` outside health endpoints.

## Abuse prevention

Redis fixed-window limits exist for login IP/account buckets and authenticated action classes including user search, chat creation, sends/edits/deletes, reactions, uploads, push changes and invite administration. Invite acceptance has an IP bucket. Typing is separately throttled per live socket.

## Asset security

- Direct S3-compatible signed PUT uploads with 10-minute intent TTL.
- 25 MB MVP limit and narrow MIME allowlist.
- Server re-reads stored bytes and verifies exact size, SHA-256 and file signature before `ready`.
- SVG/HTML/arbitrary binaries are rejected.
- Rejected objects are immediately deleted best-effort.
- Six-hour cleanup removes stale pending/rejected objects and unattached ready objects older than the retention threshold.
- Stable content URL remains authorization-gated and redirects to a short-lived signed GET with `private, no-store`.
- Malware sandboxing is required before broadening allowed document/archive/executable types.

## Push privacy and SSRF

- Server and service worker use fixed generic Sudoku notification content: no sender, conversation or message body.
- Notification click forces the visible app surface to Sudoku before focus/navigation.
- Stored Push API endpoints must be HTTPS/443 and match the configured trusted provider hostname suffixes. This prevents an authenticated user from turning the push worker into an arbitrary HTTP client.
- Default provider suffixes cover Apple Push, FCM and Mozilla Push; production egress firewall rules should mirror the configured set.

## Observability privacy

- HTTP logs contain method, templated route, status, duration and generated request ID only.
- Request bodies, query payloads, chat text, attachment contents, cookies and authorization values are never intentionally logged.
- Structured logs defensively redact common secret/token/password keys.
- Metrics never label by user/message/conversation/asset ID, preventing both privacy leakage and cardinality attacks.
- OTLP export is disabled unless an explicit collector endpoint is configured.

## Concealment behavior

- Installed name/manifest/icon: `Sudoku`.
- Normal launch: real playable Sudoku.
- Hidden gesture: press and hold keypad digit `5`, then drag upward without releasing. The entire Sudoku surface follows the finger and reveals the private surface underneath; an incomplete drag returns the Sudoku surface to its original position.
- Backgrounding for more than 30 seconds restores Sudoku before private content is shown again.

## Production runtime hardening

- Production Caddy adds HSTS, CSP, frame denial, no-referrer, COOP/CORP, nosniff and a restrictive Permissions-Policy.
- Browser network egress under CSP is limited to the application origin, the dedicated encrypted-object subdomain and the same-host secure WebSocket.
- API/Web containers run as non-root users; production Compose drops Linux capabilities and sets `no-new-privileges`.
- MinIO is not directly published in production; browsers use the TLS `assets.<APP_DOMAIN>` endpoint and a dedicated least-privilege application user.
- PostgreSQL/Redis/MinIO are not exposed as public application ports.
- Backup/restore scripts use restrictive local permissions and integrity manifests; the real restore drill remains part of Step 70.

## Dependency security

CI audits Python, npm production dependencies and the Rust `Cargo.lock`. The current RustSec scan has no known vulnerability; it reports the transitive `proc-macro-error2 2.0.1` as unmaintained (RUSTSEC-2026-0173). This is tracked as a non-blocking maintenance risk.

## Limitations

The hidden UI is privacy-of-presentation, not a security boundary or anti-forensics mechanism. A determined person with developer tooling can discover bundled messenger code. Network/DNS/device-management history can also expose the service.

Private conversation content now uses MLS/RFC 9420 through the pinned OpenMLS browser package. Message bodies, encrypted mutations and attachment keys/metadata are carried inside MLS application traffic; attachment bytes are AES-256-GCM ciphertext before upload. Production configuration rejects creation of new plaintext conversations. Remaining risk is endpoint/origin compromise: active browser XSS or a compromised device can still read plaintext after local decryption.

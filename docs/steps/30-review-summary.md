# Step 30 — Code/security review summary

## Reviewed boundaries
- Cookie authentication and device-session lifecycle.
- HTTP mutation Origin/CSRF boundary.
- WebSocket Origin, session validity and typing membership.
- Transactional outbox recipient routing.
- Multi-connection presence and push suppression.
- Asset ownership/conversation authorization and signed downloads.
- Push endpoint SSRF allowlist.
- Service-worker private-data caching behavior.
- Structured logging/redaction and telemetry cardinality.

## Defects fixed
- Immediate privacy cover restored for background/app-switcher lifecycle.
- Missing Origin is rejected for browser mutation requests.
- Active WebSockets revalidate revoked/expired sessions.
- Presence is connection-scoped; one tab cannot erase another's state.
- Push suppression follows the new multi-connection presence model.
- Session refresh is serialized to prevent concurrent rotation fan-out.

## Verified existing controls
- Private `/v1/*` traffic is never service-worker cached.
- Asset access requires ownership or current conversation membership.
- Download URLs are short-lived signed redirects with private/no-store response controls.
- Push endpoints are HTTPS/443 + hostname allowlisted.
- Message bodies, credentials and cookies are not intentionally written to application logs; defensive redaction is enabled.
- Realtime typing verifies conversation membership.
- Outbox strips server-only extra-recipient routing metadata before client fan-out.

## Remaining production work
- E2EE is not enabled yet; current server can read message plaintext. This is explicitly documented, not hidden.
- Production deployment/secrets/domain/TLS/push keys are environment work, not complete until live smoke testing.
- Mobile Safari/installed-PWA manual smoke remains required after deployment.

## Acceptance rule
Do not call the hardening complete until the full CI passes after Steps 26–29.

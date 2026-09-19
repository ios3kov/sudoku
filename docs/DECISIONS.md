# Architecture Decisions

## ADR-001 — Hidden Sudoku is not a security boundary

**Decision:** The secret gesture only changes the visible client surface. Every messenger API and WebSocket action requires normal authenticated authorization.

**Why:** Obscurity is useful for privacy of presentation, but it is not access control.

## ADR-002 — Celery + Redis instead of Temporal

**Decision:** Use Celery + Redis for background work.

**Why:** Messaging jobs are comparatively short-lived (push, thumbnails, media inspection, cleanup). Temporal would add operational weight without enough MVP benefit.

## ADR-003 — Opaque server sessions, not long-lived JWTs

**Decision:** Browser authentication will use secure HttpOnly session cookies backed by revocable server-side session records.

**Why:** Device revocation and compromised-session invalidation are first-class requirements.

## ADR-004 — PostgreSQL authoritative, Redis ephemeral

Redis must never be the only copy of a message, membership, or receipt.

## ADR-005 — Transactional outbox

A message row and its outbound event are committed in one database transaction. Workers publish committed outbox records to realtime/push systems.

## ADR-006 — Generic notification content

Push payloads shown to users contain only Sudoku-themed generic text and never sender names or message content.

## ADR-007 — E2EE is an MVP-hardening milestone, not home-grown crypto

The data model will be encryption-version aware from the start. A proven protocol/library must be selected before production E2EE is enabled. No custom cryptographic protocol will be invented.

## ADR-008 — One real Sudoku level in MVP

The shell contains a fully playable 9x9 puzzle with notes, conflict validation, persistence, reset, and completion state. A fake static Sudoku screen is explicitly rejected.


## ADR-009 — Invite issuance is administrative

Only administrators may create/revoke invite codes. The raw token is returned once and only its digest is persisted. First-admin creation is a deliberate bootstrap operation, not an open registration path.

## ADR-010 — WebSocket Origin is a security boundary

Cookie-authenticated WebSockets accept only the exact configured public origin. Browser ambient cookies must not make a cross-site WebSocket connection authoritative.

## ADR-011 — Push endpoints use an explicit provider allowlist

User-supplied Push API endpoints are outbound-request destinations. Production defaults therefore allow only configured HTTPS push-service hostname suffixes, with infrastructure egress policy expected to mirror the same list.

## ADR-012 — Orphan assets are bounded

Uploads that fail validation are deleted immediately when possible; stale pending/rejected and unattached ready objects are removed periodically. Object storage is not allowed to grow indefinitely from abandoned uploads.

## ADR-013 — OTLP observability with privacy-safe cardinality

OpenTelemetry is the common telemetry layer for API and workers, exported over OTLP/HTTP when a collector is configured. Logs remain structured JSON. Message content, credentials and private identifiers are excluded from observability payloads, and metrics use bounded attributes only. Celery telemetry initializes after worker fork because batch exporters use background threads.

## ADR-014 — Conversation-local group ownership

Group administration is controlled by `conversation_members.role`, not by global application admin status. Multiple owners are allowed, but at least one owner must remain. This keeps invitation/system administration separate from private-group authority.

## ADR-015 — Removed members receive a durable removal event

Transactional outbox events may carry reserved server-only extra-recipient metadata. The dispatcher unions those recipients with current membership and strips the reserved field before fan-out. This lets a removed member learn that access was revoked without making Redis the durable source of truth.

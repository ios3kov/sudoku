# Architecture Decisions

## ADR-001 — Hidden Sudoku is not a security boundary
The gesture changes presentation only; server authorization remains mandatory.

## ADR-002 — PostgreSQL authoritative, Redis ephemeral
Durable application state is PostgreSQL; Redis is ephemeral coordination/presence/rate-limit state.

## ADR-003 — Opaque revocable sessions
Browser authentication uses Secure HttpOnly opaque session tokens stored hashed server-side.

## ADR-004 — Transactional outbox
Durable mutation and outbound event commit atomically.

## ADR-005 — Generic push
Push never includes sender, conversation or message content.

## ADR-006 — E2EE is a production blocker
Production must not trust the hosting provider with message or attachment plaintext.

## ADR-007 — MLS is the single messaging protocol
Use MLS (RFC 9420) for both two-party and group conversations. A two-party direct conversation is an MLS group of two. This removes the need to maintain separate Signal-style and group protocols.

## ADR-008 — OpenMLS 0.9.x is the implementation candidate
OpenMLS is standards-based, maintained, recently audited and supports WebAssembly builds. Versions are pinned and security advisories reviewed before release.

## ADR-009 — Upstream openmls-wasm demo bindings are not production-ready
The upstream wrapper is publish=false, uses in-memory provider state and has panic/todo paths unsuitable for hostile production inputs. We build a narrow binding around pinned OpenMLS crates with explicit persistence and error handling.

## ADR-010 — MLS KeyPackages replace Signal-style prekeys
The final delivery-service API stores/claims MLS KeyPackages rather than identity/signed-prekey/one-time-prekey bundles. Steps 35–36 prekey endpoints are migration/spike code and must be removed before production.

## ADR-011 — Ciphertext-only attachments
Files are encrypted client-side before S3-compatible upload; keys travel only inside E2EE messages.

## ADR-012 — Server plaintext search is incompatible with E2EE
Content search for E2EE conversations is local-device search over decrypted local state.

## ADR-013 — Production starts E2EE-only
Existing plaintext development history is not migrated as trusted production history.


## ADR-014 — Native iOS augments the web client instead of replacing the messaging stack
Keep the Next.js UI, FastAPI backend and MLS protocol. The iOS app is a narrow native capability host for platform features Safari/PWA cannot provide reliably. Native code must not fork authorization, message formats or E2EE behavior.

## ADR-015 — Exactly one global administrator
Production may contain at most one global `is_admin = true` user. Only that singleton administrator may create or revoke account invitations. Conversation-local owner roles remain independent and never grant global invite authority. The invariant is enforced at the database boundary, not only in UI code.

## ADR-016 — Native contacts are explicit selection, not address-book ingestion
The preferred iOS integration is a system contact picker that returns only contacts the user explicitly selected. Only selected phone numbers cross the native bridge and flow through the existing contact-matching API. Silent full-address-book upload is out of scope.

## ADR-017 — Mature messengers are design references, not source donors
Signal iOS, Element X and similar AGPL/GPL projects may inform UX/security patterns, but their source is not copied into this project. Permissively licensed code still requires review before reuse. Product behavior is implemented against Sudoku Messenger's own architecture and acceptance tests.

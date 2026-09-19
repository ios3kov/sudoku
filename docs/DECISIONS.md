# Architecture Decisions

## ADR-001 — Hidden Sudoku is not a security boundary
The gesture changes presentation only; server authorization remains mandatory.

## ADR-002 — PostgreSQL authoritative, Redis ephemeral
Messages, membership, sessions and audit history are durable in PostgreSQL.

## ADR-003 — Opaque revocable sessions
Browser auth uses Secure HttpOnly opaque tokens stored hashed server-side.

## ADR-004 — Transactional outbox
Durable mutation and outbound event commit atomically.

## ADR-005 — Generic push
Push never includes sender, conversation or message content.

## ADR-006 — E2EE is a production blocker
Production must not rely on trusting the hosting provider with message/attachment plaintext. Direct messaging uses a reviewed asynchronous ratcheting protocol; groups use a reviewed group protocol such as MLS. No custom cryptographic protocol.

## ADR-007 — Official libsignal is not assumed browser-ready
Official libsignal is valuable protocol/reference material but its published TypeScript path uses native Node bindings, external use is unsupported, APIs may change, and AGPL licensing requires deliberate review. A browser-compatible audited implementation must be selected/validated before coding.

## ADR-008 — Ciphertext-only attachments
Files are encrypted client-side before S3-compatible upload. Storage/provider sees ciphertext, size/timing metadata and object identifiers, not plaintext bytes.

## ADR-009 — Server plaintext search is incompatible with E2EE
Current server-side content search is disabled/removed for E2EE conversations. Any future content search is local-device search over decrypted local state.

## ADR-010 — Production starts E2EE-only
Existing development plaintext data is not treated as private production history. New production conversations require E2EE protocol state from creation.

# Step 38 — OpenMLS browser interoperability spike

## Goal
Validate a concrete reviewed browser E2EE backend before wiring the messenger UI.

## Candidate
OpenMLS 0.9.0, released 2026-08-25, implementing MLS (RFC 9420).

MLS supports groups from two participants upward, so direct chats and group chats can use one protocol instead of combining a Signal-style pairwise protocol with a separate group protocol.

## Findings

### Positive
- RFC 9420 standard protocol.
- OpenMLS 0.9.0 is current and has recent security fixes.
- OpenMLS has undergone an external security audit; reported issues were remediated in maintained releases, with release notes documenting remaining low-severity work.
- The project supports WebAssembly/browser builds through its `js` feature.
- The official `openmls-wasm` crate exposes primitives for identities, KeyPackages, group creation/join, membership commits, application-message encryption/decryption and secret export.

### Blocking issues with the official demo wrapper
The upstream `openmls-wasm` crate is `publish = false` and is not a production-ready JS package.
Its current wrapper:
- uses an in-memory Rust crypto provider;
- does not expose a production persistence/import/export boundary for complete MLS state;
- contains `unwrap()`, `todo!()` and `unimplemented!()` paths in JS-facing message handling;
- fixes one ciphersuite and exposes only a narrow subset of lifecycle operations.

Therefore we must not copy or ship the upstream wrapper unchanged.

## Architecture correction
Earlier Steps 35–36 used Signal-style identity/signed-prekey/one-time-prekey terminology. That is not the right final server primitive if we standardize on MLS.

For MLS the delivery service should store opaque/public:
- device credentials / identity public material as required by our credential policy;
- MLS KeyPackages;
- Welcome / Commit / Proposal messages;
- opaque application ciphertext;
- group routing/membership metadata required by the delivery service.

KeyPackages are consumed/rotated according to MLS semantics; the server does not invent a Signal-style prekey lifecycle.

## Decision
Adopt **MLS / RFC 9420** as the target E2EE protocol for both direct and group conversations, with **OpenMLS 0.9.x** as the implementation candidate.

Do not ship the existing Signal-style prekey API as the production E2EE contract. It remains migration/spike code until replaced by the MLS KeyPackage contract.

## Next
Step 39:
1. replace Signal-style prekey API/schema with MLS KeyPackage registry and atomic claim;
2. keep message envelopes opaque;
3. build a thin audited-surface WASM adapter around pinned OpenMLS 0.9.x rather than using upstream demo bindings as-is;
4. require state serialization/persistence and browser interoperability tests before UI activation.

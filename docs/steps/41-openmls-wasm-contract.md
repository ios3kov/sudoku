# Step 41 — OpenMLS WASM production binding contract

## Goal
Define the minimal browser binding surface before adding Rust/WASM code.

## Versioning
- Pin OpenMLS to an explicit 0.9.x release.
- Do not depend on a moving git main branch.
- Record the exact crate graph and lockfile in-repo.
- Treat OpenMLS upgrades as security-sensitive changes requiring interoperability reruns.

## Required browser-facing operations
The WASM module must expose fallible APIs for:
1. create device identity/credential state;
2. create one or more MLS KeyPackages;
3. create an MLS group for a conversation;
4. add member from a claimed KeyPackage;
5. emit Commit + Welcome bytes;
6. join from Welcome + required public group context;
7. process Proposal/Commit/Welcome/application MLS messages;
8. encrypt application payload bytes;
9. decrypt application payload bytes;
10. remove member / update epoch;
11. export complete encrypted-at-rest-eligible protocol state;
12. restore complete protocol state after reload/offline restart;
13. return protocol/version/group/epoch metadata needed for routing and diagnostics.

## Hard safety requirements
- No JS-reachable `unwrap()`, `expect()`, `panic!`, `todo!` or `unimplemented!` paths for malformed/untrusted network input.
- All untrusted byte parsing returns structured errors.
- Enforce size limits before deserialization.
- Never log plaintext, secret key material or serialized private group state.
- Private state never leaves the browser except encrypted local persistence explicitly controlled by the client.
- WASM API must not expose raw private keys unless strictly required by state export; prefer opaque serialized state.
- Zero/replace transient plaintext buffers where practical within WASM/JS limitations.

## Persistence contract
The WASM module owns MLS protocol serialization semantics. JavaScript only stores opaque serialized state using BrowserProtocolStateStore.

State export/import must include everything needed to survive:
- page reload;
- browser process restart;
- offline send/receive queue;
- epoch transitions;
- membership changes.

A reload must not generate a new identity or silently fork group state.

## Interoperability acceptance
Before UI activation:
- Alice creates group, Bob joins from KeyPackage/Welcome.
- Alice -> Bob encrypted application message.
- Bob -> Alice reply.
- Reload both clients from exported state and continue.
- Add Charlie; all three exchange messages.
- Remove Bob; Bob cannot decrypt a later epoch message.
- Reordered duplicate transport messages fail safely.
- Corrupt handshake/application bytes return errors, never trap/panic.
- KeyPackage replay is rejected by delivery-service semantics.
- Two simultaneous package claims never return the same package.
- Direct two-member conversation uses the same MLS path as larger groups.

## UI activation gate
The existing plaintext composer remains the only dev path until this acceptance suite passes. Production deployment remains blocked until the messenger UI routes all production conversations through the MLS adapter and encrypted attachment pipeline.

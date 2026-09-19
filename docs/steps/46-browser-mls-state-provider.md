# Step 46 — Browser-safe MLS provider state

## Goal
Provide durable browser MLS state without filesystem persistence and without exposing private key material to JavaScript as separate keys.

## Design
A custom `Provider` is composed entirely from official OpenMLS components:
- `RustCrypto` for cryptography/randomness;
- `MemoryStorage` for OpenMLS protocol storage;
- `OpenMlsProvider` re-exported by OpenMLS.

No fork of OpenMLS is required and the Cargo dependency graph is unchanged.

## Persistence
The provider exposes:
- `exportState()` -> opaque bounded binary state blob;
- `Provider.fromState(bytes)` -> validated restore.

JavaScript stores that opaque blob through the existing `BrowserProtocolStateStore`, which encrypts it with a non-exportable WebCrypto wrapping key before IndexedDB persistence.

## Binary format v1
- 8-byte magic/version: `SMLSST01`;
- big-endian entry count;
- deterministic key-sorted entries;
- each entry contains bounded key/value lengths followed by raw bytes.

Limits:
- maximum blob: 16 MiB;
- maximum entries: 100,000;
- checked integer/size arithmetic;
- duplicate keys rejected;
- truncated/trailing/corrupt input rejected.

## Safety
JS-facing state import/export uses explicit `Result` errors. No network-controlled parsing path in this binding uses `unwrap`, `expect`, `panic!`, `todo!` or `unimplemented!`.

Test-only assertions may use `expect`; they are not compiled into the production WASM API.

## CI
The locked OpenMLS package now runs native Rust unit tests and a `wasm32-unknown-unknown` compile check.

## Capability
`persistent_state=true`, but `ui_ready=false`. This only proves provider state round-trip plumbing; MLS group interoperability is still required before UI activation.

## Next
Step 47: implement fallible device credential + MLS KeyPackage generation on this provider, then verify KeyPackage bytes round-trip through the delivery-service API.

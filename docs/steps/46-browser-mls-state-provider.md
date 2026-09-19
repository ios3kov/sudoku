# Step 46 — Browser-safe MLS provider state

## Goal
Provide durable browser MLS state without filesystem persistence and without exposing private key material to JavaScript as separate keys.

## Design
A custom `Provider` is composed from official OpenMLS components:
- `RustCrypto`;
- `MemoryStorage`;
- `OpenMlsProvider`.

The Cargo dependency graph remains locked and unchanged.

## Persistence
The provider exposes:
- `exportState()` -> opaque bounded binary state blob;
- `Provider.fromState(bytes)` -> validated restore.

JavaScript stores this blob through `BrowserProtocolStateStore`, encrypted by a non-exportable WebCrypto wrapping key before IndexedDB persistence.

## Format and limits
State blob v1 uses `SMLSST01`, deterministic key ordering, checked big-endian lengths, a 16 MiB maximum and 100,000-entry maximum. Duplicate keys, truncation, trailing bytes and overflow are rejected.

## First Rust CI finding
The provider methods were annotated for wasm-bindgen but the `Provider` struct itself was not. Rust correctly rejected the JS ABI because the type had no wasm-bindgen ABI implementation.

## Fix
The struct is now explicitly `#[wasm_bindgen]`. No storage format or cryptographic behavior changed.

## CI
Native Rust unit tests cover deterministic state round-trip and corrupt-state rejection. The same locked crate is then compiled for `wasm32-unknown-unknown`.

## Capability
`persistent_state=true`, `ui_ready=false`.

## Next
Step 47: device credential + KeyPackage generation with signer recovery from persisted provider state.

# Step 45 — Pinned OpenMLS WASM package skeleton

## Goal
Introduce OpenMLS as an isolated Rust/WASM package without activating it in the messenger UI.

## Verified
The package compiles for `wasm32-unknown-unknown` with:
- Rust 1.91.0
- openmls 0.9.0
- openmls_rust_crypto 0.6.0
- openmls_basic_credential 0.6.0
- wasm-bindgen 0.2.105
- getrandom 0.2.17 JS backend

The generated Cargo.lock has been committed to main as commit `29d05d7`.

## CI
The temporary bootstrap write permission and self-commit step were removed immediately after lockfile generation.

CI is read-only again and runs:
`cargo +1.91.0 check --manifest-path packages/mls-wasm/Cargo.toml --target wasm32-unknown-unknown --locked`.

## Current WASM surface
Only protocol/version/capability reporting is exposed. `persistent_state=false` and `ui_ready=false`.

## Security status
The package is isolated from the UI and cannot yet encrypt production messages. Production remains blocked until the Step 41 interoperability and persistence acceptance criteria pass.

## Next
Step 46: implement a browser-safe provider using official RustCrypto + MemoryStorage and bounded state export/import without filesystem or panic paths.

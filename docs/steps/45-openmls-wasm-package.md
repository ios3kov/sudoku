# Step 45 — Pinned OpenMLS WASM package skeleton

## Goal
Introduce OpenMLS as a separately testable Rust/WASM package without activating it in the messenger UI.

## Pinned dependency set
- Rust 1.91.0
- openmls 0.9.0 with `js` feature
- openmls_rust_crypto 0.6.0
- openmls_basic_credential 0.6.0
- wasm-bindgen 0.2.105
- getrandom 0.2.17 JS backend for transitive RustCrypto randomness

## Surface
The initial module exposes only:
- protocol name;
- pinned OpenMLS version;
- capability JSON explicitly reporting `persistent_state=false` and `ui_ready=false`.

No group creation, encryption, decryption or key generation is exposed yet.

## CI gate
CI installs Rust 1.91.0 + wasm32-unknown-unknown and runs `cargo check --locked` against this package.

The committed lock file is intentionally not considered valid until generated from the manifest. CI is expected to fail at the lock/dependency stage first; that failure is used to capture the exact reproducible graph before enabling the package.

## Security
The package is isolated from the app. UI cannot import/use it yet. Production remains blocked.

## Next
Generate and commit the actual Cargo.lock from the pinned manifest, then implement only fallible state/provider primitives required by the Step 41 contract.

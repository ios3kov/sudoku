# Step 45 — Pinned OpenMLS WASM package skeleton

## Goal
Introduce OpenMLS as an isolated Rust/WASM package without activating it in the messenger UI.

## Verified baseline
The bootstrap run successfully compiled the package for `wasm32-unknown-unknown` with Rust 1.91.0 and the pinned OpenMLS dependency set. All existing API, MLS delivery-service, web build and production-compose gates were green in the same run.

## Pinned set
- Rust 1.91.0
- openmls 0.9.0
- openmls_rust_crypto 0.6.0
- openmls_basic_credential 0.6.0
- wasm-bindgen 0.2.105
- getrandom 0.2.17 JS backend

## Lockfile bootstrap
CI generates the lockfile from the pinned manifest, runs wasm32 `cargo check --locked`, then commits only `packages/mls-wasm/Cargo.lock` if it differs. This is a one-time bootstrap mechanism.

After the generated lock lands in main, the bootstrap self-commit step must be removed and CI must use the committed lockfile read-only with `cargo check --locked`.

## Current WASM surface
Only protocol/version/capability reporting is exposed. `persistent_state=false` and `ui_ready=false`; there is no production crypto activation yet.

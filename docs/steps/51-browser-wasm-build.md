# Step 51 — Reproducible browser OpenMLS WASM build

## Goal
Generate the actual browser-consumable OpenMLS WebAssembly package in local development, CI and the production Web Docker image from the same pinned sources and tool versions.

## Build contract
- Rust toolchain: 1.91.0.
- OpenMLS dependency graph: committed Cargo.lock.
- wasm-bindgen crate/CLI: 0.2.105.
- browser target: `web`.
- generated files are build artifacts and are not committed.

The cross-platform `npm run build:mls-wasm` script installs/uses those exact versions, builds the release wasm32 target, and emits JS, TypeScript declarations and the WebAssembly binary into `apps/web/generated/mls-wasm`.

## Why direct wasm-bindgen
The build intentionally avoids adding wasm-pack/wasm-opt as another production transformation layer. The exact wasm-bindgen CLI version matches the Rust crate pinned in Cargo.toml/Cargo.lock.

## CI
The OpenMLS native interoperability/security tests run first. CI then generates the browser package before Web TypeScript checks and the Next production build. It asserts all three generated artifacts exist.

## Production Docker
The Web Dockerfile has an isolated Rust builder stage using the same Rust/OpenMLS/wasm-bindgen versions, then copies only generated browser artifacts into the final Node image.

## Runtime loader
`openmls-runtime.ts` is browser-only, verifies required WebCrypto/IndexedDB capabilities, initializes the generated WebAssembly module and rejects any capability/version mismatch before returning it.

## Security status
The WASM module is now buildable and importable by the PWA, but production message UI is still not switched to it. `ui_ready` remains false.

## Next
Step 52: implement the concrete OpenMlsProtocolAdapter with atomic local-state persistence/rollback and durable control-event processing where ACK happens only after successful OpenMLS mutation + encrypted IndexedDB commit.

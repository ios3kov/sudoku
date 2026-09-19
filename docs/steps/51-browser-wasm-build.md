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

## Verified browser gate
The first implementation successfully generated the real `.wasm + JS + .d.ts` bindings and passed Web typecheck + Next production build.

## CLI supply chain and performance
Compiling `wasm-bindgen-cli` from crates.io on every cold runner was correct but unnecessarily slow.

The build now downloads the official wasm-bindgen 0.2.105 prebuilt release for the detected host platform and verifies a **pinned SHA-256 digest before extraction/execution**.

Pinned platforms:
- Linux x64/arm64;
- macOS x64/arm64;
- Windows x64.

The production Docker stage uses the same official x64 Linux artifact and pinned digest.

This changes only the host-side binding generator installation path; Rust/OpenMLS sources, the wasm target and generated binding version remain unchanged.

## CI
The OpenMLS native interoperability/security tests run first. CI then generates the browser package before Web TypeScript checks and the Next production build. It asserts all three generated artifacts exist.

## Production Docker
The Web Dockerfile has an isolated Rust builder stage using the same Rust/OpenMLS/wasm-bindgen versions, then copies only generated browser artifacts into the final Node image.

## Runtime loader
`openmls-runtime.ts` is browser-only, verifies required WebCrypto/IndexedDB capabilities, initializes the generated WebAssembly module and rejects any capability/version mismatch before returning it.

## Security status
The WASM module is buildable and importable by the PWA. The visible production composer is still not switched until later E2EE gates pass.

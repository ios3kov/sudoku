# Step 47 — Persistent device identity and MLS KeyPackages

## Goal
Generate MLS credentials/KeyPackages in browser WASM while keeping private signing and KeyPackage material inside persisted OpenMLS provider state.

## Device identity
The provider creates and stores an Ed25519 signer internally. JavaScript receives only a bounded application credential and 32-byte public-key handle. After reload, the signer is recovered from provider storage with `SignatureKeyPair::read`.

## KeyPackages
The provider creates MLS 1.0 KeyPackages using X25519 + ChaCha20Poly1305 + SHA-256 + Ed25519. OpenMLS stores the corresponding private KeyPackage bundle; only public serialized KeyPackage bytes leave WASM.

Incoming KeyPackages are size-bounded, TLS-decoded, checked for trailing bytes, validated under MLS 1.0, and restricted to the configured ciphersuite.

## CI findings
1. TLS codec traits initially resolved to private derive macros; fixed by importing public `tls_codec` traits explicitly.
2. The malformed-KeyPackage native test called the JS-facing wrapper. Creating `JsError` on a non-wasm target panics by design in wasm-bindgen.

## Fix
KeyPackage validation now has a target-neutral internal function returning `Result<_, String>`. The WASM wrapper only maps that error to `JsError` at the JS boundary. Native tests exercise valid and hostile inputs through the target-neutral path.

## Acceptance
Rust tests cover identity creation, KeyPackage generation, provider export/restore, signer recovery after reload, post-reload package generation, valid package canonicalization, and malformed package rejection.

## Capability
`device_identity=true`, `key_packages=true`, `persistent_state=true`, `ui_ready=false`.

## Next
Step 48: two-member group create/join via KeyPackage + Welcome and encrypted application-message exchange after reload.

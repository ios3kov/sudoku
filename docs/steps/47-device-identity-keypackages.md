# Step 47 — Persistent device identity and MLS KeyPackages

## Goal
Generate MLS credentials/KeyPackages in browser WASM while keeping private signing and KeyPackage material inside persisted OpenMLS provider state.

## Device identity
`Provider.createDeviceIdentity(credentialBytes)` creates an Ed25519 signer, persists it in OpenMLS storage, and returns only credential bytes plus the 32-byte public key.

After reload, `DeviceIdentity.fromPublic(...)` reconstructs the public handle and `SignatureKeyPair::read(...)` restores the private signer from provider storage.

## KeyPackages
`createKeyPackage(identity)` builds an MLS 1.0 KeyPackage using X25519 + ChaCha20Poly1305 + SHA-256 + Ed25519. OpenMLS stores the private KeyPackage bundle; JS receives only serialized public bytes.

`validateKeyPackage(bytes)` applies size limits, TLS decoding, MLS 1.0 validation, ciphersuite validation and trailing-byte rejection.

## First Rust CI finding
The initial import used `Deserialize/Serialize` from the OpenMLS prelude and resolved to private derive macros rather than the public `tls_codec` traits. That prevented `tls_deserialize` / `tls_serialize_detached` from being in scope.

## Fix
Import the traits explicitly from `openmls::prelude::tls_codec`.

## Acceptance
Rust tests cover identity creation, KeyPackage generation, provider export/restore, signer recovery, post-reload KeyPackage generation, valid-package canonicalization and malformed-package rejection.

## Capability
`device_identity=true`, `key_packages=true`, `persistent_state=true`, `ui_ready=false`.

## Next
Step 48: two-member group create/join via KeyPackage + Welcome and encrypted application-message exchange after reload.

# Step 47 — Persistent device identity and MLS KeyPackages

## Goal
Generate MLS credentials/KeyPackages in browser WASM while keeping all private signing and KeyPackage material inside persisted OpenMLS provider state.

## Device identity
`Provider.createDeviceIdentity(credentialBytes)`:
- validates bounded application credential bytes;
- generates an Ed25519 signing key with OpenMLS BasicCredential support;
- stores the private signer in OpenMLS `MemoryStorage`;
- returns a `DeviceIdentity` containing only credential bytes and the 32-byte public key.

After reload, JavaScript can reconstruct that public handle with `DeviceIdentity.fromPublic(...)`. The provider restores the private signer through `SignatureKeyPair::read(...)` from the encrypted provider-state blob.

## KeyPackage generation
`Provider.createKeyPackage(identity)`:
- reloads the signer from provider storage;
- builds an MLS 1.0 KeyPackage using
  `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519`;
- lets OpenMLS store the associated private KeyPackage bundle in provider storage;
- returns only serialized public KeyPackage bytes for delivery-service publication.

## Untrusted KeyPackage validation
`Provider.validateKeyPackage(bytes)`:
- enforces a 64 KiB input limit;
- rejects malformed or trailing bytes;
- validates MLS 1.0 structure/signature with OpenMLS;
- rejects unsupported ciphersuites;
- returns canonical validated bytes.

## Persistence acceptance
Rust tests verify:
1. identity creation;
2. KeyPackage generation;
3. provider-state export/restore;
4. signer recovery after restore;
5. new KeyPackage generation after reload;
6. public KeyPackage validation;
7. corrupt package rejection.

## Privacy boundary
Private signing keys and private KeyPackage material are not exposed as JS byte arrays. They exist only inside the provider storage blob, which the web layer encrypts before IndexedDB persistence.

## Capability
`device_identity=true`, `key_packages=true`, `persistent_state=true`, `ui_ready=false`.

## Next
Step 48: create/join a two-member MLS group using KeyPackage + Welcome, persist both sides, then exchange an encrypted application message after reload.

# Step 37 — Browser crypto adapter boundary

## Goal
Prepare the PWA for a reviewed E2EE implementation without inventing a Signal/MLS protocol in application code.

## Research
- Signal's official libsignal still states external use is unsupported and its TypeScript distribution is not a simple browser-native dependency.
- Matrix Rust SDK provides WebAssembly bindings and production browser crypto, but it is a Matrix crypto stack rather than a drop-in implementation for this custom transport.

## Implemented
- ProtocolAdapter interface for reviewed future WASM/native crypto backend.
- Fail-closed unavailable adapter: no fallback to plaintext.
- Browser capability gate for secure context, WebCrypto, secure randomness and IndexedDB.
- BrowserProtocolStateStore encrypts serialized protocol state at rest using a non-exportable AES-GCM WebCrypto wrapping key stored in IndexedDB.
- E2EE envelope/device/prekey TypeScript types.
- Web API methods for publishing public device bundles, atomically claiming one prekey and sending ciphertext envelopes.

## Security boundary
AES-GCM here protects local serialized protocol state at rest. It is not a messaging protocol and does not replace a ratchet/MLS implementation. An XSS/origin compromise can still access decrypted state while the app is running, so CSP/XSS hardening remains mandatory.

## Not yet wired
The messenger UI still uses the legacy plaintext path. Production remains blocked. We will only switch conversation creation/send to encryption_required after a reviewed browser protocol backend passes interoperability, identity-change, offline and multi-device tests.

## Next
Evaluate a concrete WASM crypto backend with a minimal interoperability spike; no production switch until it passes the documented E2EE acceptance suite.

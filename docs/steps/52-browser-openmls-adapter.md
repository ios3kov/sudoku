# Step 52 — Crash-safe browser OpenMLS adapter

## Goal
Connect the generated OpenMLS WASM runtime to the real browser transport/state layer without enabling plaintext fallback.

## Existing crash-safe foundation reviewed
The current adapter already provides:
- encrypted IndexedDB persistence through BrowserProtocolStateStore;
- persistent device identity + device registration;
- durable KeyPackage generation/publication;
- two-phase membership transitions;
- atomic Commit+Welcome control batches;
- pending transition retry across reload;
- ACK only after successful OpenMLS mutation + local encrypted persistence;
- rollback to the previous provider snapshot when local persistence fails;
- serialization of application traffic behind a pending membership transition.

## Application messages
The missing ProtocolAdapter methods are now implemented.

`encrypt()` serializes the complete private application payload inside MLS:
- message type;
- body;
- reply target;
- asset ids.

The server receives only the serialized MLS application ciphertext envelope.

`decrypt()`:
1. requires an `application` MLS envelope;
2. processes it through OpenMLS;
3. validates the decrypted payload schema;
4. persists the advanced receive-ratchet state;
5. rolls back the in-memory provider if persistence or payload validation fails.

This is important because decrypting an MLS PrivateMessage advances receiver ratchet state and must be durable before the operation is considered successful.

## No plaintext fallback
The concrete adapter still fails closed if the WASM runtime/capabilities/state cannot load. The legacy UI is not yet switched to production E2EE, and `ui_ready` remains false.

## Remaining production gates
Before UI activation:
- identity pinning / safety-number verification independent of the server;
- encrypted attachments and encrypted edit/reaction events;
- end-to-end browser integration tests for reload/network failure/control-event retry;
- switch conversation creation and composer/history rendering to the concrete adapter;
- final security review and mobile/PWA smoke tests.

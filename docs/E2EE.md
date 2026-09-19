# End-to-End Encryption Plan

## Production gate
Production deployment is blocked until message and attachment content is end-to-end encrypted and the browser implementation passes interoperability/security acceptance tests.

## Protocol decision
Use Messaging Layer Security (MLS, RFC 9420) for both direct chats and group chats. A direct chat is an MLS group of two participants. This avoids maintaining separate pairwise and group cryptographic protocols.

Implementation candidate: OpenMLS 0.9.x.

The upstream OpenMLS WebAssembly demo wrapper is not shipped unchanged. We require a thin application-specific binding with explicit error handling, durable state persistence, no `unwrap()/todo!/unimplemented!` paths reachable from untrusted messages, and pinned reviewed dependencies.

## Threat model
E2EE protects content from hosting/database/object-store operators and server compromise that does not also compromise active endpoints.

E2EE does not hide all metadata: account/device identifiers, routing membership, timing, approximate sizes, network metadata and push metadata may remain visible.

A compromised browser origin/XSS can read plaintext after client decryption. CSP, dependency integrity and device security remain mandatory.

## Server boundary
The server is a delivery service, not a decryption endpoint:
- stores opaque MLS application messages and handshake/control messages;
- stores public MLS KeyPackages for asynchronous session/group establishment;
- atomically hands out/consumes KeyPackages as required by application semantics;
- never receives MLS private state;
- never performs plaintext content search;
- push remains generic.

## Browser state
Private MLS state remains client-side. Serialized protocol state is encrypted locally before IndexedDB persistence with a non-exportable WebCrypto wrapping key. No private crypto state is stored in localStorage.

## Attachments
Attachments are encrypted client-side with AES-256-GCM before upload. The attachment key, nonce, original filename/MIME and plaintext integrity metadata are transported inside an MLS-protected application message. The API/object store receive only generic `application/octet-stream` ciphertext, ciphertext length and ciphertext SHA-256.

## Acceptance criteria
- fresh two-device direct chat interoperates asynchronously;
- group create/add/remove/rejoin operations interoperate;
- KeyPackage reuse races are prevented;
- reordered/retried transport messages fail safely or decrypt according to MLS semantics;
- identity/credential changes are surfaced;
- revoked/removed devices cannot decrypt future epochs after group update;
- database and object store contain no plaintext message/attachment content;
- local MLS state survives reload and offline reconnect;
- corrupt/hostile MLS messages return errors and cannot panic the WASM module;
- dependency versions and security advisories are reviewed before release.

## Device identity authentication

MLS authenticates messages cryptographically, but the application must bind MLS credentials to account/device identities.

Before adding a claimed KeyPackage, the browser:
1. validates the KeyPackage with OpenMLS;
2. verifies its BasicCredential equals the expected application device credential;
3. verifies its signature key equals the device identity key returned by discovery;
4. compares that key with the locally encrypted TOFU pin for the same user/device.

An unexpected key change is fail-closed and requires explicit recovery/new-device handling.

For first-contact protection against a malicious delivery service, clients expose a symmetric SHA-256 safety number derived from both device identities. Users can compare this value over an independent channel. The local verified marker is stored only in encrypted browser state; the server cannot mark itself trusted.

# End-to-End Encryption Plan

## Production gate

Production deployment is blocked until message and attachment content is end-to-end encrypted. The server must not receive plaintext message bodies or plaintext attachment bytes.

## Threat model

E2EE protects content from the hosting provider, database/object-store operators, server compromise that does not also compromise an active client, backups and infrastructure administrators.

E2EE does **not** hide all metadata. The service can still learn account identifiers, device/session existence, conversation membership needed for routing, message timing, approximate sizes, IP/network metadata and push subscription metadata.

A compromised endpoint/browser origin can read content after decryption. XSS prevention and device security remain critical.

## Protocol direction

### Direct conversations

Use a reviewed Signal-style asynchronous ratcheting protocol with:
- per-device identity keys;
- signed prekeys + one-time prekeys;
- authenticated session establishment;
- Double Ratchet-style forward secrecy/post-compromise recovery;
- explicit identity-key change UX.

Do not invent cryptographic primitives or a custom ratchet.

Official libsignal is a protocol/reference candidate, not an automatic browser dependency: its official TypeScript distribution is primarily a native Node bridge, external use is unsupported by Signal, APIs may change, and licensing must be reviewed before adoption.

### Groups

Use an RFC 9420 MLS-compatible implementation or another independently reviewed group protocol. Do not implement “one shared AES group key” as the production group design.

## Browser key storage

Long-term private keys must never be sent to the API. Prefer non-exportable WebCrypto keys where the chosen protocol permits. Protocol state that must be serializable is encrypted locally with a device storage key before IndexedDB persistence.

No private key or decrypted message is stored in localStorage.

## Server model changes

Server becomes ciphertext transport:
- message plaintext column is no longer accepted for E2EE conversations;
- store ciphertext envelope + protocol/version metadata;
- prekey/key-package endpoints expose public material only;
- device identity public keys are append/audit tracked;
- server search over message plaintext is removed for E2EE conversations;
- replies reference opaque message IDs;
- push remains generic.

## Attachments

Before upload:
1. Generate random per-asset content key client-side.
2. Encrypt bytes client-side with an AEAD construction from a reviewed crypto API/library.
3. Upload ciphertext only.
4. Put encrypted asset-key material and integrity metadata inside the E2EE message envelope.

Object storage must never receive plaintext attachment bytes.

## Migration

Existing server-readable messages are development/test data and are not migrated as trusted private history. Production starts with E2EE-only conversations.

## Acceptance criteria

- API rejects plaintext creation for E2EE conversations.
- Database/object-store inspection shows no message/attachment plaintext.
- Two fresh devices can establish a direct session asynchronously.
- Duplicate/reordered/retried transport messages decrypt correctly or fail safely.
- Identity key changes are surfaced.
- Revoked devices cannot decrypt newly rotated group/direct content.
- Group add/remove rotates cryptographic state.
- Offline/reconnect works without server plaintext.
- Lost-device/recovery behavior is explicit and tested.
- Cryptographic protocol/library choice and license are documented before implementation.

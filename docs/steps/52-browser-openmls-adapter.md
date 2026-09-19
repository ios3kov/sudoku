# Step 52 — Concrete browser OpenMLS adapter and crash-safe ACK

## Goal
Connect the generated OpenMLS WASM runtime to the web application's durable local state and MLS delivery-service API without enabling the production composer yet.

## Initialization
The adapter is scoped to one authenticated application user/device id.

On first use it:
1. loads the pinned OpenMLS WASM runtime;
2. creates the OpenMLS provider and persistent device identity;
3. stores one encrypted local state bundle in IndexedDB;
4. registers only the public MLS identity key with the server.

On later use it restores both provider state and the public identity handle from the encrypted local state bundle.

## Local state
One AES-GCM protected IndexedDB value contains:
- opaque OpenMLS provider state;
- public credential bytes;
- public identity key;
- IDs of control events that were processed locally but whose ACK may still need retry.

Private signer and KeyPackage private material remain inside the opaque OpenMLS provider state.

## Serialization and crash safety
All OpenMLS mutations are serialized through a per-adapter operation queue.

For a received Commit/Welcome:
1. apply the OpenMLS mutation;
2. add the event id to local pending-ACK state;
3. export OpenMLS state;
4. durably encrypt/store the combined state in IndexedDB;
5. ACK the server event;
6. remove the pending-ACK marker and persist again.

If the app crashes between steps 4 and 5, restart sends the ACK before fetching more control events and does not apply the MLS message twice.

## Application messages
The adapter encrypts a small versioned JSON application payload containing message body/type/reply/asset identifiers. The whole payload is inside MLS ciphertext.

Encrypt and decrypt both persist provider state after success because MLS sender/receiver ratchets advance.

## KeyPackages and groups
The adapter can:
- create and publish KeyPackages;
- create an MLS group using the conversation id as group id;
- add a member from a claimed KeyPackage;
- join from Welcome;
- process Commit messages.

## Server transport
Control-event payload bytes are base64 only at the HTTP boundary. Server realtime notification wakes the browser; the adapter fetches durable control events and ACKs only after local state persistence.

## Production gate
This adapter is compiled and usable but is not yet wired to the visible production messenger composer. Identity pinning/verification, encrypted attachments, and UI migration remain blockers before `ui_ready=true`.

## Next
Step 53: local identity pinning + human-verifiable fingerprint/QR data and explicit identity-change blocking, so a malicious/compromised delivery service cannot silently replace a peer device identity.

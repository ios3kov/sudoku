# Step 48 — Two-party MLS interoperability after reload

## Goal
Prove the selected OpenMLS binding can establish a real two-member MLS group and exchange encrypted application messages after both clients reload from persisted provider state.

## Runtime API
The provider now exposes fallible:
- `createGroup(identity, groupId)`;
- `addMember(identity, groupId, keyPackage)`;
- `joinGroup(welcome)`;
- `encryptApplication(identity, groupId, plaintext)`;
- `decryptApplication(groupId, mlsMessage)`.

Each operation loads the group from OpenMLS provider storage by group id. JavaScript does not own a second long-lived copy of group cryptographic state.

## Group creation
Groups use the pinned ciphersuite and enable the RFC ratchet-tree extension. The Welcome therefore carries the tree material required by the joiner and no separate application-defined tree payload is needed.

## Persistence property
OpenMLS writes sender/receiver ratchet changes to the configured storage during message processing. The binding's provider-state blob therefore remains the single persistence boundary.

## Input boundaries
- group id: 1–128 bytes;
- serialized MLS message: max 1 MiB;
- application plaintext: 1–256 KiB;
- KeyPackage validation reuses Step 47 limits and canonical validation.

All untrusted parsing paths return target-neutral errors before the WASM wrapper maps them to JavaScript errors.

## Interoperability test
The Rust test performs:
1. Alice and Bob create persistent device identities.
2. Bob creates a KeyPackage.
3. Alice creates the group.
4. Alice adds Bob and emits Commit + Welcome.
5. Alice merges her pending membership commit.
6. Bob joins from Welcome.
7. Alice and Bob export their complete provider state.
8. Both providers are reconstructed from exported state.
9. Alice encrypts an application message; reloaded Bob decrypts it.
10. Reloaded Bob encrypts a reply; reloaded Alice decrypts it.

## Capability
`two_party_groups=true`, `application_messages=true`, but `ui_ready=false`.

## Next
Step 49: handshake delivery semantics and 3-member add/remove epoch rotation, including removed-member inability to decrypt a later epoch.

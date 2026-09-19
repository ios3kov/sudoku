# Step 49 — MLS membership rekey and removal confidentiality

## Goal
Prove that membership changes advance MLS epochs correctly and that a removed member cannot decrypt subsequent application messages.

## Runtime API
Added:
- `processHandshake(groupId, message)`: accepts only verified MLS Commit outcomes and merges the staged commit into local group state.
- `removeMember(identity, groupId, memberCredential)`: resolves the member inside MLS by credential, creates a Remove commit, merges the local pending commit, and returns the serialized commit for delivery.

The application never accepts a server-provided leaf index as authority for removal.

## Three-member acceptance flow
1. Alice creates the MLS group.
2. Bob joins from KeyPackage + Welcome.
3. Alice adds Charlie.
4. Bob receives and applies Alice's Add commit.
5. Charlie joins from Welcome.
6. Alice sends an application message; Bob and Charlie decrypt it.
7. Alice removes Bob by Bob's MLS credential.
8. Charlie applies the Remove commit and advances epoch.
9. Bob applies the same commit and becomes inactive/self-removed.
10. Alice sends a message in the new epoch.
11. Charlie decrypts successfully.
12. Bob's decryption attempt fails.

## Security property
The test proves forward membership confidentiality at the application boundary: a member removed from the group no longer has usable state for messages encrypted in the following MLS epoch.

## Handshake safety
Incoming handshake bytes are bounded and parsed through the same MLS decoder. Only `StagedCommitMessage` and matching `OwnPendingCommit` outcomes are merged; unrelated message content is rejected.

## Capability
`membership_rekey=true`, while `ui_ready=false`.

## Next
Step 50: persist/deliver MLS handshake messages through the application API/outbox so browser clients can apply Commit/Welcome transitions through the real server transport rather than only the Rust interoperability harness.

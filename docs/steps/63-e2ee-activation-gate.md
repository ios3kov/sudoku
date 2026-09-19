# Step 63 — E2EE conversation activation gate

## Goal
Prevent a server conversation from becoming usable or visible as an active secure chat before its MLS bootstrap finishes.

## State
`conversations.e2ee_ready` is added. Legacy creation sets it true; E2EE creation sets it false. Existing development conversations migrate as ready.

## Pending secure conversation
Before activation:
- application-message creation returns 409 even with ciphertext;
- MLS KeyPackage/control transport remains usable for bootstrap;
- `conversation.created` is not emitted;
- only the creator can see the pending conversation through normal conversation listing.

A peer racing to create the same pending direct chat receives 409 rather than taking over another device's unfinished setup.

## Activation
Only the original creator can activate. Activation flips `e2ee_ready=true` under row lock, emits the first `conversation.created` event to current members, and is idempotent.

## Security property
A half-bootstrapped secure conversation cannot accept application traffic or appear as a normal ready chat to recipients.

## Next
Step 64: NewChat MLS bootstrap orchestration, including active-device discovery, KeyPackage claims, ordered Commit/Welcome transitions and activation only after all transitions are durably delivered.

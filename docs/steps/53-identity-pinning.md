# Step 53 — KeyPackage identity binding and safety numbers

## Goal
Prevent the delivery service from silently substituting an MLS KeyPackage for a different device identity, and provide an independent first-contact verification mechanism.

## Rust/OpenMLS binding
The binding validates a claimed KeyPackage before group mutation:
- full OpenMLS KeyPackage validation;
- expected BasicCredential match;
- expected Ed25519 signature public key match.

The expected credential is derived as `sudoku-v1:<user-id>:<device-id>`.

Rust tests reject the same valid KeyPackage when either expected credential or expected public key is wrong.

## Claim API
The KeyPackage claim response includes the target `user_id`, `device_id`, identity public key and KeyPackage bytes. This gives the browser enough context to derive the exact expected credential.

## Local TOFU pin
After successful KeyPackage identity validation, the browser stores the first `(user, device, identity public key)` binding inside the encrypted protocol-state record.

A later different identity key for the same user/device throws `PeerIdentityChangedError` before the package is used.

The pin participates in the same snapshot/rollback transaction as the MLS membership mutation, so failed validation or local persistence does not leave a false trust record.

## Safety number
The adapter exposes a symmetric SHA-256 safety number derived from both endpoints' canonical user id, device id and identity public key.

Both endpoints compute the same value only when they hold the same view of the two device identity keys. The value can be compared through an independent channel.

`markPeerIdentityVerified()` stores a local verification timestamp in encrypted state; the server cannot set it.

## Production status
Identity changes are now fail-closed and KeyPackages are bound to pinned device identities. UI activation remains blocked pending encrypted attachments/events and browser end-to-end retry tests.

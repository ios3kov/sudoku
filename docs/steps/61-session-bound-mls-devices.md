# Step 61 — Stable session-bound MLS devices

## Goal
Give each authenticated browser session one stable MLS device identity and prevent one logged-in device from impersonating or consuming another device's MLS transport.

## Stable session UUID
Authentication refresh now rotates only the bearer secret and expiry while preserving the session row/id.

The pre-lock token hash is captured and the locked row is force-refreshed from PostgreSQL. If another concurrent refresh already changed the hash, the stale refresh fails with 401 instead of rotating again.

This preserves the session UUID as a stable cryptographic device id without weakening token rotation.

## Device binding
MLS device registration requires `device_id == current session id`.

An MLS device is considered active only when:
- its registry row is not revoked;
- the matching auth session belongs to the same user;
- the auth session is not revoked;
- the auth session has not expired.

Device discovery therefore stops advertising expired/revoked browser sessions.

## Device isolation
The following operations are bound to the current session device:
- device registration;
- KeyPackage publication/discard;
- MLS control sender id;
- unified/control feed fetch;
- control ACK.

A session for device A cannot fetch/ACK device B's MLS controls or publish crypto state on its behalf.

Claiming a remote user's public KeyPackage remains allowed, as required for group establishment.

## Session revoke/logout
Logout or session revocation also:
- marks the matching MLS device revoked;
- deletes its unclaimed KeyPackages.

Consumed KeyPackage tombstones remain for replay protection.

## Integration test
The test verifies:
1. login creates a current session id;
2. that exact id registers as the MLS device;
3. auth refresh keeps the same session/device id;
4. device discovery still exposes it after refresh;
5. revoking the session revokes the MLS device.

## Next
Step 62: initialize one OpenMlsProtocolAdapter from the current session id in MessengerShell, replenish KeyPackages automatically and sync unified transport on realtime/reconnect.

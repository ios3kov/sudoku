# Step 39 — MLS KeyPackage delivery-service contract

## Goal
Replace the Signal-style prekey spike with the correct MLS asynchronous membership primitive.

## Database
Migration 0008 creates `mls_key_packages` and removes the transitional `device_key_bundles` and `device_one_time_prekeys` tables.

Each KeyPackage is stored as opaque binary plus a SHA-256 package reference. The reference is globally unique, so a consumed package cannot simply be uploaded again and reused.

## API
- Publish 1–100 opaque KeyPackages for the authenticated user's device.
- List target devices with available-package counts only.
- Atomically claim one KeyPackage with `FOR UPDATE SKIP LOCKED`.
- Claimed packages remain stored with `claimed_at`; they are never returned again.
- Device owner may discard only unclaimed packages.

The server does not parse MLS private state and does not generate KeyPackages.

## Web contract
Signal-style bundle/prekey TypeScript types and API methods are replaced by MLS device availability and claimed KeyPackage types.

## Security properties
- no private MLS key material reaches the server;
- package replay/re-registration is blocked by unique SHA-256 reference;
- concurrent claims cannot normally receive the same row;
- claimed packages are retained as tombstones/audit state rather than deleted.

## Pending verification
GitHub Actions provisioning is currently failing before job steps execute. The next working runner must compile Python, apply 0006–0008 on clean PostgreSQL, run API tests, then typecheck/build the web client.

## Next
Add explicit integration tests for KeyPackage publication/claim/replay, then build the narrow pinned OpenMLS 0.9.x WASM binding with durable state export/import.

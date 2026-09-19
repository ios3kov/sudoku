# Step 39 — MLS KeyPackage delivery-service contract

## Goal
Replace the Signal-style prekey spike with the correct MLS asynchronous membership primitive.

## Database
Migration 0008 creates `mls_key_packages` and removes transitional Signal-style key tables.

Each package is stored as opaque binary plus a globally unique SHA-256 reference. Claimed packages remain as tombstones with `claimed_at`, preventing simple re-registration/reuse.

## API
- publish 1–100 opaque KeyPackages per authenticated device;
- list target devices with available-package counts;
- atomically claim one package with PostgreSQL `FOR UPDATE SKIP LOCKED`;
- discard only unclaimed packages owned by the current user.

## Tests
Integration coverage verifies:
- two packages can be published;
- availability reports two;
- two claims return different packages;
- third claim returns 409;
- replay/re-registration of a consumed package returns 409;
- database retains both rows with non-null `claimed_at`.

## Web contract correction
The protocol adapter now models MLS group state rather than per-message recipient prekeys:
- create KeyPackages;
- create/join group;
- add member via claimed KeyPackage;
- process handshake messages;
- encrypt/decrypt application messages against persisted group state.

## Pending verification
GitHub Actions provisioning is failing before job steps execute. These changes are not marked verified until compile, migrations, API integration, web typecheck/build and production-compose gates run.

## Next
Build a narrow pinned OpenMLS 0.9.x WASM binding with durable state persistence and explicit error handling.

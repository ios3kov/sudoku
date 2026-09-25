# Step 110 — application-level restore verification

Date: 2026-09-25.

## Goal

Strengthen the existing disposable restore audit so recovery is verified through the real application API, not only through PostgreSQL row counts and object hashes.

## Fixture

Before the CI dump, the audit creates a synthetic restore-only fixture in the disposable database:

- active phone-authenticated user with a real Argon2 password hash;
- active E2EE conversation;
- ciphertext-only file message with an envelope;
- ready encrypted asset backed by the synthetic ciphertext object.

The fixture exists only inside disposable CI services.

## Restore verification

After PostgreSQL is restored into an isolated database and object bytes are restored into the pinned MinIO container, a fresh Python process is pointed at the restored database and restored object bucket.

The probe then uses the real FastAPI application routes to:

1. log in by phone/password;
2. list the restored conversation and verify E2EE state;
3. read the restored ciphertext message and asset metadata;
4. request the authorization-gated asset content endpoint;
5. follow the returned signed MinIO URL;
6. verify the downloaded encrypted object SHA-256 matches the pre-backup bytes.

The existing schema/table row-count comparison, Alembic-version equality, object hash/metadata checks and AES-GCM recovery check remain.

## Evidence

`audit-performance/restore.json` now records an `applicationProbe` section for login, conversation, message and encrypted-asset download.

## Boundary

This materially strengthens CI disaster-recovery coverage, but it is still a disposable synthetic restore. It does not measure production RTO/RPO and does not restore real production backup bytes. A production-aligned isolated restore of the latest real backup remains a release gate before production deployment.

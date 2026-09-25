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

## Merge verification

PR #100 merged to main as `effa0e03349d7ec04f88350b166bffec7e65aad8`.

Exact post-merge verification:
- `ci #720` / 36175072493 — success;
- `device-access #403` / 36175072562 — success;
- `beat-runtime #405` / 36175072546 — success;
- `api-shutdown #387` / 36175072498 — success.

The Infra log records HTTP 200 for restored phone login, conversation list, message history and asset metadata, HTTP 302 for the authorization-gated content endpoint, followed by a successful signed object download with matching ciphertext SHA-256. The JSON evidence reports `applicationProbe.login/conversation/message/encryptedAssetDownload = passed`; artifact `restore-audit-36175072493-1` was retained.

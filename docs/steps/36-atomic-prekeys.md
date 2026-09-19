# Step 36 — Atomic one-time prekey consumption

## Goal
Guarantee that a one-time prekey is never returned to two concurrent session initiators.

## Changes
- Migration 0007 adds normalized device_one_time_prekeys rows.
- One-time public prekeys are no longer exposed by the general device-list endpoint.
- Bundle upload replenishes unconsumed prekeys transactionally.
- Claim endpoint selects one unconsumed prekey with PostgreSQL row locking and SKIP LOCKED, marks it consumed, then returns it.
- Revoked device bundles cannot be claimed.
- Restored the missing Message.envelope ORM mapping required by migration 0006.

## Security property
The server still sees only public prekey material. Private identity/session keys never leave clients. Atomic consumption prevents ordinary concurrent claim races from reusing the same one-time prekey.

## Limitations
This is transport/key-distribution plumbing, not an E2EE protocol implementation. Client identity verification, ratchet state, MLS groups and encrypted attachments remain pending.

## Verification
CI remains blocked by a GitHub Actions job-provisioning failure occurring before steps start. GitHub public status reports Actions operational, so this is tracked separately from code correctness. Next successful runner must execute compileall, 0006+0007 migrations and API integration tests before production status changes.

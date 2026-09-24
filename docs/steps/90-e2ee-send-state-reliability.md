# Step 90 — durable E2EE send states and recovery controls

Date: 2026-09-24.

## Goal

Make encrypted outgoing-message state explicit and recoverable without changing the MLS wire format or creating duplicate sends.

User-visible text-message lifecycle:

`Encrypting… -> Sending… -> Sent`

When delivery cannot complete:

- offline after local encryption/persistence -> `Queued`;
- online transport failure after local encryption/persistence -> `Failed`;
- `Retry` resends the already persisted ciphertext with the same client id;
- `Remove` deletes a queued application message locally and never transmits it later.

Accepted messages continue to use the existing `Sent` / read-receipt metadata.

## Architecture

The existing OpenMLS durable outbox remains authoritative.

Before network delivery, `queueApplicationSend()` already:

1. advances the local MLS sender state;
2. creates the encrypted application envelope;
3. persists the envelope, cloned domain event, client id and asset ids in `pendingApplicationSends`;
4. only then attempts the server POST.

This step exposes that durable boundary to the UI instead of creating a second queue.

New adapter operations:

- `retryPendingApplicationSend(clientId)` — serializes through the existing adapter operation queue and flushes the durable conversation queue in order;
- `discardPendingApplicationSend(clientId)` — removes only a pending application **message** and persists the new local state atomically; edits/reactions/deletes are not discardable;
- an optional prepared callback lets the composer move from `Encrypting…` to `Sending…` only after the encrypted send is durable locally.

Retry remains idempotent because the same persisted client id and ciphertext are reused.

## Media boundary

Encrypted image/file/voice sends now surface an immediate failed pending row if transport fails after upload/encryption and can be retried.

`Remove` applies to pending text, image/file and voice application messages so a permanently rejected media send cannot block the durable conversation queue. When a completed encrypted upload is removed before any message links it, the existing `cleanup_orphan_assets` worker deletes unlinked ready assets older than 24 hours; no plaintext asset exists.

## Critical MLS removal invariant

Discarding an unsent encrypted message means the sender has advanced its MLS application generation even though the peer never receives that ciphertext.

The browser recovery acceptance therefore must prove:

1. queue a text while offline;
2. remove it before reconnect;
3. reconnect;
4. send a later encrypted text;
5. the peer decrypts the later text;
6. the removed text is never accepted by either side.

If this scenario fails, `Remove` must not ship; restrict removal rather than weakening MLS validation.

## Verification

Required before merge:

- web TypeScript;
- ESLint;
- production web build;
- existing browser regression;
- E2EE recovery acceptance with:
  - offline `Queued`;
  - online transient failure -> `Failed`;
  - manual `Retry` -> exactly one accepted message;
  - offline `Remove` -> removed message absent;
  - later MLS message decrypts after the skipped generation;
- code review of adapter serialization, persistence rollback and duplicate-send behavior;
- exact-head GitHub Actions green.

## Release boundary

Repository work only.

No production deployment, migration, TestFlight upload or App Store submission is authorized by this step. Production remains on the previously recorded server release and database migration `0016_phone_contacts`; migrations `0017_single_admin` and `0018_session_biometrics` remain undeployed until their separate production gate.


## Merge verification — 2026-09-24

PR #70 merged to `main` as `32e869e10f8c14ae1caabda89e9d20c19e45200c`.

Reviewed exact head `3c0f74efd0c5440b943a0c4eccfcf25d9a2d334c` passed:

- ci `35974275667`, including browser E2E and production image builds;
- device-access `35974275666`;
- beat-runtime `35974275664`;
- ios-native `35974275686`;
- api-shutdown `35974275659`.

No production deployment or TestFlight/App Store upload occurred.

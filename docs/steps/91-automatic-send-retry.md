# Step 91 — automatic transient send retry

Date: 2026-09-24.

## Goal

Complete the remaining message-delivery reliability item from Step88:

- automatically retry **transient** encrypted send failures;
- keep **permanent** failures under explicit user control;
- preserve one durable ciphertext + one `client_id` across every retry;
- never run parallel retry loops for the same conversation;
- stop automatic retry after a bounded number of attempts and expose Retry / Remove.

No MLS wire-format change is allowed.

## Reference patterns

The design follows behavior seen in mature messaging clients rather than inventing a second transport model:

- Element X exposes Retry / Remove for failed messages and explains the failure;
- Signal distinguishes retryable send failures and has repeatedly had to guard against duplicate user submissions;
- Rocket.Chat has documented duplicate encrypted-media sends when reconnect/retry is not idempotent, reinforcing the need for one stable request identity and serialized retries.

Only behavioral patterns are used. No GPL/AGPL source is copied.

## Failure classification

For the message-create request:

### Transient

Automatic retry is allowed for:

- network errors without an HTTP status;
- HTTP 408;
- HTTP 409 (the current API uses this for temporary E2EE setup/rekey states);
- HTTP 425;
- HTTP 429;
- HTTP 5xx.

### Permanent

All other HTTP 4xx responses are treated as permanent until the user explicitly retries or removes the message. Examples include:

- 401/403 authentication or contact-policy denial;
- 404 missing conversation;
- 422 invalid message/asset/reply payload.

## Backoff

Automatic attempts use capped exponential backoff:

1. 1 second;
2. 2 seconds;
3. 4 seconds;
4. 8 seconds;
5. 16 seconds.

After five automatic attempts, the message becomes `Failed` and requires Retry or Remove.

Only one automatic retry timer may exist for the conversation. The OpenMLS adapter operation queue remains the serialization authority.

## UX states

- local encryption/persistence: `Encrypting…`;
- first network delivery: `Sending…`;
- offline durable state: `Queued`;
- transient failure waiting for automatic retry: `Retrying…`;
- retry request in flight: `Sending…`;
- permanent/exhausted failure: `Failed`;
- accepted server message: existing `Sent` / read-receipt states.

## Idempotency invariant

Every automatic and manual retry must reuse the already-persisted:

- MLS ciphertext envelope;
- `client_id`;
- asset IDs and encrypted attachment metadata.

The server already enforces idempotency on `(sender_id, client_id)` and re-checks it while holding the conversation lock. Retry must never create a fresh message identity.

## Lifecycle

- timers are RAM-only and cancelled when the conversation component unmounts;
- the durable pending ciphertext remains in IndexedDB;
- after reload/reopen, a pending message may restart its retry budget from attempt 1, but still uses the same persisted `client_id` and ciphertext;
- going offline pauses automatic timers; reconnect can resume from the durable queue;
- secure incoming sync polling must not create a second parallel outgoing retry loop.

## Verification

Required before merge:

- domain tests for transient/permanent classification and exact backoff;
- web lint/typecheck/build;
- existing E2EE recovery acceptance;
- browser E2E proving:
  - transient network failure retries automatically without a user click;
  - the retry reuses the durable message and yields exactly one accepted visible message;
  - a permanent 422 stays Failed and does not auto-retry;
  - manual Retry still works after permanent failure;
- existing offline queue, Remove, skipped-generation and voice regressions remain green;
- exact-head CI, device-access, beat-runtime, api-shutdown and ios-native are green.

## Release boundary

Repository work only.

No production deployment, migration, TestFlight upload or App Store submission is authorized by this step.


## Merge verification — 2026-09-24

PR #71 merged to `main` as `8c57dc1942420a84147f742fa44a62dc36eab133`.

Reviewed exact head `7501cb7c0de15daef0b9b824bb5d905d5b34d9b0` passed:

- ci `35979002030`, including domain retry-policy tests, browser E2E, performance and production application image build;
- ios-native `35979002023`;
- api-shutdown `35979002060`;
- device-access `35979002048`;
- beat-runtime `35979002032`.

At the time this record was written, GitHub had not exposed post-merge workflow runs for the squash SHA, so this section intentionally records the exact reviewed PR head rather than inventing post-merge evidence.

No production deployment, migration, TestFlight upload or App Store submission occurred.

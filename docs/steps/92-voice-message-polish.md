# Step 92 — voice message preview, waveform and scrub

Date: 2026-09-24.

## Goal

Upgrade encrypted voice messages from immediate-send + native browser controls to a deliberate messenger-grade flow:

`record -> stop -> local preview -> play/pause/scrub -> Send or Delete`.

The behavior is informed by mature clients such as Signal iOS and Element X. Only UX/architecture patterns are used; no GPL/AGPL implementation code is copied.

## Product behavior

### Recording

- microphone acquisition remains explicit and bounded by the existing maximum duration;
- Stop always remains available even if secure sync becomes blocked;
- stopping a healthy recording creates a **local voice draft** instead of uploading/sending immediately;
- recording errors discard partial bytes and never create a sendable draft;
- leaving/hiding the private surface destroys the draft URL and microphone resources.

### Local preview

After Stop the normal composer is replaced by a compact voice preview:

- Play / Pause;
- duration;
- waveform;
- tap/drag scrub;
- Delete;
- Send.

The draft stays local until **Send** is pressed. Delete must perform zero upload/message calls.

### Sent voice messages

- custom voice control replaces the raw browser `<audio controls>` UI;
- waveform and duration are visible before playback when metadata is available;
- Play lazily downloads + decrypts the ciphertext audio;
- waveform supports accessible seek/scrub once playback is ready;
- old voice messages without waveform metadata remain playable through a neutral fallback waveform.

## E2EE / privacy

Audio transport is unchanged:

- audio bytes are encrypted client-side with the existing AES-256-GCM attachment pipeline;
- the server continues to receive only ciphertext asset bytes plus the normal encrypted-message asset linkage;
- voice duration and waveform are attached to the attachment metadata **inside the MLS encrypted application event**;
- duration/waveform are not added to the plaintext API schema or database message fields.

Proposed optional encrypted metadata:

```ts
voice?: {
  durationMs: number;
  waveform: number[]; // normalized 0..1, bounded sample count
}
```

Compatibility:

- metadata remains version 1;
- `voice` is optional;
- legacy encrypted attachments without it remain valid;
- invalid/out-of-range voice metadata fails closed during MLS event validation.

## Waveform rules

- target: 48 normalized samples;
- every sample is finite and clamped to `0..1`;
- maximum accepted sample count: 128;
- duration must be a positive integer and not exceed the product voice limit;
- analysis is local;
- if audio decoding/analyzing is unavailable, the draft remains sendable with duration and an empty waveform; UI renders a neutral fallback.

## Resource lifecycle

- object URLs are revoked on Delete, successful Send, conversation unmount/hide and replacement;
- playback is stopped on unmount;
- only one local voice draft exists per active conversation view;
- microphone tracks and recorder callbacks keep the existing teardown guarantees;
- no plaintext audio is persisted to IndexedDB.

## Accessibility

- Play/Pause, Send and Delete have explicit accessible names;
- scrub control exposes an accessible slider/value;
- duration uses text in addition to waveform graphics;
- controls retain at least the existing 44px touch target behavior.

## Verification

Required before merge:

- current microphone lifecycle/error regressions stay green;
- Stop no longer causes an upload automatically;
- local preview appears after a successful Stop;
- Delete causes no upload or protocol send;
- Send causes exactly one encrypted upload/message send;
- double Send is prevented;
- draft object URL is revoked on unmount/delete/send;
- metadata validator accepts legacy attachments and valid voice metadata, rejects malformed/out-of-range metadata;
- encrypted receiver renders waveform/duration from MLS metadata;
- playback download/decrypt failure remains retryable;
- web lint/typecheck/build/performance;
- browser acceptance;
- exact-head ci, device-access, beat-runtime, api-shutdown and ios-native.

## Release boundary

Repository work only.

No production deployment, migration, TestFlight upload or App Store submission is authorized by this step.

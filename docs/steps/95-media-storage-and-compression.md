# Step 95 — Russian media storage and client-side compression

Date: 2026-09-24. Status: repository implementation in progress; no production changes.

## Product decisions

- Use a private object store in a Russian region; evaluate Selectel first. Confirm regional placement, access isolation, operator account protection and restore procedures before procurement.
- Store ciphertext only. Compress before encrypting on the sender device; never provide media keys to a storage/compression service.
- Keep linked media until explicit deletion or a separately approved retention policy. A 90-day threshold is only a candidate for storage tiering, not deletion.
- Preserve message asset IDs during migration. Copy and verify ciphertext before switching storage, retain rollback, and delete source objects only after explicit migration acceptance.
- Keep database and object recovery points consistent. Backups do not restore lost client MLS keys; deletion semantics must account for backup expiry and recovery.

## Delivery sequence

1. JPEG photo preparation: Standard quality (target long edge up to 2048 px, JPEG quality 0.82) / Original selected bytes. Preserve smaller files when re-encoding would increase size. No silent fallback after a preparation error.
2. Voice recording: [Step96](96-voice-recording-compression.md) implements a mono preference and 32 kbit/s target with platform fallback; actual bitrate may differ by browser. Measure intelligibility, playback and size on Safari/iPhone before enabling.
3. Video: design native iOS transcoding plus a tested web fallback; offer Standard / Original, bound duration/input/output size and memory, preserve orientation/audio, and support cancellation. Do not claim this is already implemented.
4. Storage choice: estimate 100 GB and 1 TB with normal/high download rates, requests, archive retrieval, minimum retention and independent backups. Test access from users' mobile networks.
5. Provider adapter/configuration and copy/verify/read-switch rollback procedure; then authorized production migration.
6. Quotas and operator alerts; optional age-based tiering only if it saves money and meets chat retrieval requirements.

## First implementation boundary

JPEG photos only. PNG/WebP/GIF (including possible animation/transparency), videos and documents retain their selected bytes. Native Photos converts selected images to JPEG before returning them; Original in this UI means the returned selected file, not guaranteed camera/HEIC archival bytes. JPEG frame headers are inspected before decoding, with a 50-megapixel limit. The existing 25 MiB input limit remains; larger source files need a separate memory-safe design.

Photo preparation must run before encrypted upload. No file is uploaded on selection or Cancel. A decoding/encoding failure is visible and does not silently send the original. Bitmap/canvas resources are released after processing. This pass is not a device performance or visual-quality acceptance.

## Verification

- Browser regressions for dimensions, byte-size savings, original byte preservation, unchanged unsupported media and failed decoding.
- Conversation regression: selecting a JPEG opens a quality choice, Cancel sends nothing, Standard passes prepared bytes to the encrypted uploader.
- Existing attachment, voice, E2EE and lifecycle regressions remain gates.
- Manual iPhone: Photos/Files sources, portrait EXIF orientation, large images, Standard/Original visual quality, navigation/cancel and memory behavior.

## Primary references

- [Selectel S3](https://docs.selectel.ru/s3/about/about-s3/) and [billing model](https://docs.selectel.ru/s3/about/payment/): evaluate concrete regional tariffs before provisioning.
- [createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap): honor source image orientation and release decoded resources.
- [MediaRecorder bitrate](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/audioBitsPerSecond): requested bitrate is not guaranteed output bitrate.

## Local evidence

ESLint passes with existing repository warnings. Both the photo helper fixture and encrypted-conversation fixture compile. Local typecheck reports only the absent generated OpenMLS module; full CI builds that module and is the typecheck/browser gate. Standalone local Chromium is constrained by the operator Mac sandbox. No physical-device compression-quality pass is claimed.

## Release boundary

No paid provisioning, production deployment, migrations, object copying/deletion, TestFlight or App Store release in this step without explicit authorization. Accessibility and physical-iPhone acceptance in issue #63 remain open.

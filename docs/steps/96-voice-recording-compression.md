# Step 96 — speech-oriented voice encoding

Date: 2026-09-24. Repository implementation; physical-device acceptance remains open.

## Behavior

Voice recording requests one audio channel as an ideal constraint and a 32,000 bit/s encoder target. Existing supported MIME selection is preserved (MP4 when supported, then WebM/Opus). Compression happens during recording on the sender device, before the local preview, E2EE encryption and upload. Existing preview, explicit Send, five-minute limit and cancellation/resource cleanup remain authoritative.

If the MediaRecorder constructor reports NotSupportedError for the explicit bitrate, retry once on the same acquired stream and selected format with platform-default bitrate. Other construction failures are not retried. If either fallback construction or recording fails, release the microphone and retain existing visible error behavior. The mono constraint is an ideal, not a requirement that rejects stereo-only devices.

32 kbit/s is a requested target, not a fixed file-size guarantee. Browser encoding and container overhead vary. Do not describe existing voice recording as previously uncompressed; this step tunes its encoding budget. Existing recordings and imported audio files are not transcoded.

## Validation

- Fixture regressions check mono/bitrate requests, no upload before explicit Send, unsupported-bitrate fallback without a second microphone request, cleanup on Hide, and no retry for general construction errors.
- A real Chromium MediaRecorder encodes synthetic audio; the result must decode with non-silent samples, one channel and a bounded short-recording size. This is codec compatibility evidence, not human speech-quality acceptance.
- Existing voice draft, waveform, send, hide, late permission and recorder-error regressions remain required.
- Physical iPhone: quiet/noisy speech, speaker/microphone and Bluetooth routes, playback on both clients, durations up to five minutes, interruptions and repeated recordings. Record actual bytes/minute and intelligibility before release acceptance.

## References

- [MediaRecorder constructor](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/MediaRecorder): audioBitsPerSecond encoding hint.
- [Actual audio bitrate](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/audioBitsPerSecond): output may differ from the requested value.

## Plan relationship and release boundary

Continues [Step95](95-media-storage-and-compression.md). JPEG preparation is in PR #75; video transcoding, Russian S3 procurement/migration and optional archive tiering remain separate work. No paid provisioning, production changes, TestFlight or App Store release. Accessibility and physical-iPhone acceptance remain unchecked.

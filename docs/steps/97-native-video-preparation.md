# Step 97 — native iOS video preparation

Date: 2026-09-24. Implementation under review; device acceptance remains open.

## Behavior

The iOS attachment picker accepts videos from Photos and Files. Standard prepares an MP4 on the sender device using Apple's 1280x720 preset (H.264/AAC), before the existing E2EE encryption and upload. Original keeps the selected file bytes when they fit the attachment limit. Web/PWA keeps its existing original-file path; browser transcoding is not implemented.

Standard accepts a source up to 250 MiB, up to 120 seconds and up to 33,554,432 encoded pixels per frame. Preparation has a 90-second deadline. Only a positive-size output at most 25 MiB crosses the native bridge. Exported duration must match within 0.15 seconds, a video track must remain, and an audio track must remain when present in the source. Truncated exports are rejected. These checks do not prove audiovisual quality or synchronization.

The preset is not a guarantee that every file becomes smaller. Original is available only for a supported video MIME type and at most 25 MiB. MOV originals use video/quicktime. No server-side plaintext transcoding or automatic upload is added.

Large sources stay in app-owned temporary files rather than crossing into JavaScript. Provider-owned files are copied before their callback lifetime ends. Cancel and backgrounding abort preparation; late callbacks cannot finish a newer selection. Temporary copies are removed on completion/cancellation. Forced termination can leave temporary files until system cleanup; this is not archival storage.

## Orientation

The application remains portrait-only. Preserving portrait or landscape video content during export does not rotate the application. Landscape UI is permitted only for playback of a landscape video; that dedicated playback exception is still pending. See the [mobile orientation contract](88-native-ios-production-plan.md#mobile-orientation-contract).

## Validation and acceptance

Simulator tests cover real portrait-video export, output dimensions/duration/size, duration rejection, cancellation and oversized input rejection before decoding. The iOS workflow builds and runs the test target. Local Swift parsing is not a substitute for that build.

Physical-iPhone acceptance remains open: Photos and Files including iCloud, landscape/portrait video, HEVC/HDR and audio synchronization, short/long/high-detail clips, Original bytes, cancellation/backgrounding, repeated selection, memory/disk pressure and readable error states. Simulator results must not mark this acceptance or Accessibility complete.

## References and release boundary

- [Apple 1280x720 export preset](https://developer.apple.com/documentation/avfoundation/avassetexportpreset1280x720)
- [AVAssetExportSession](https://developer.apple.com/documentation/avfoundation/avassetexportsession)
- [Temporary provider file lifetime](https://developer.apple.com/documentation/foundation/nsitemprovider/loadfilerepresentation(forTypeIdentifier:completionHandler:))

Continues [Step95](95-media-storage-and-compression.md) and [Step96](96-voice-recording-compression.md). Russian private S3 procurement/migration and archive tiering remain pending. No production deployment, migrations, TestFlight or App Store release is authorized by this step.

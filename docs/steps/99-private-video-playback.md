# Step 99 — private video playback and scoped orientation

Date: 2026-09-24. Repository implementation; physical-device acceptance remains open.

Encrypted video attachments open a dedicated viewer after the existing authorized download and client-side decryption. Supported MIME types are MP4, QuickTime and WebM; codec playback depends on the device. Unsupported content has a visible error. Files remain bounded to 25 MiB. No decrypted media is uploaded for playback.

On iPhone the trusted main-frame bridge transfers bounded file bytes, never an arbitrary network URL, to a protected app-owned temporary file. AVFoundation validates playability and determines the displayed aspect ratio including the camera transform. A full-screen container embeds Apple's player. Only this controller may allow landscape, and only for landscape content. All ordinary screens and portrait/square video stay portrait. Closing, navigation, session disposal and app privacy-cover activation stop playback, remove the temporary file and restore the portrait policy. A request identifier prevents a late close from cancelling another viewer. Picture-in-picture and external playback are disabled. Forced process termination can leave temporary files until OS cleanup; this is not permanent media storage.

The plist lists all orientations needed by the player; the app delegate and root controller constrain normal UI to portrait. Listing landscape in the plist is not permission for the messenger to rotate. iOS 16+ uses scene geometry updates on return; iOS 15 uses UIKit's supported-orientation transition. Physical-device verification of return transitions remains required.

Web/PWA uses a modal local-blob video viewer with controls, inline playback, keyboard close/focus restoration and cleanup on unmount/page hide. Browser/OS rotation cannot be universally locked by a webpage; strict portrait application policy is enforced by the native iOS host. The web fallback does not claim that native orientation guarantee. Legacy plaintext attachments retain their existing download path.

## Validation

Native tests cover payload bounds/type rejection, displayed orientation transforms and player orientation masks. Existing real exporter tests remain enabled. Browser tests cover native byte handoff, session-specific cancellation, late decryption after unmount, and real generated video decoding in the web viewer with Escape/background cleanup. CI must validate the exact head before merge.

Physical iPhone: play portrait/landscape/square MP4/MOV, HEVC/HDR/unsupported codecs; rotate during play/pause, close while landscape, navigate/lock/revoke/background, ensure portrait return and no app-switcher media exposure. Check sound, VoiceOver, large text and no persistent temporary copies after ordinary close. This checklist is not completed by simulator tests.

## References

- [Apple AVPlayerViewController](https://developer.apple.com/documentation/avkit/avplayerviewcontroller): embed the system playback controller.
- [App orientation policy](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/application(_:supportedinterfaceorientationsfor:))
- [Scene geometry updates](https://developer.apple.com/documentation/uikit/uiwindowscene/requestgeometryupdate(_:errorhandler:))
- [WKScriptMessageHandlerWithReply](https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply)

No production deployment, migrations, TestFlight or App Store release is part of this change.

## Merge evidence

Reviewed head `f093d2ce125cfdfbf56a8fe2d7f5a0dc20c2c9c8` passed all five workflows and merged as `06f188cfbf28f094e064c3aa5c6ce578d3f3c5d4`. Verification includes 82 browser tests and 8 native exporter/playback-policy tests. Physical-device and full accessibility acceptance remain open; no production change was performed.

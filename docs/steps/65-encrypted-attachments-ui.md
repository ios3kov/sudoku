# Step 65 — Encrypted image, file and voice UI

## Goal
Activate the existing ciphertext-only attachment primitives in the real encrypted conversation UI without reusing any legacy plaintext attachment path.

## Outbound files and images
EncryptedConversationView now encrypts selected files locally with a fresh AES-256-GCM key/nonce, uploads only application/octet-stream ciphertext, and sends the asset id plus decryption/integrity metadata only inside the MLS application event.

Original filename and MIME never reach the upload API.

## Voice notes
Voice recording keeps the browser MediaRecorder flow, but the resulting audio File goes through the same encrypted upload path before the MLS message is created.

Supported recording containers remain audio/mp4 and audio/webm. Recording is capped at five minutes and microphone tracks/timers are cleaned up on completion and component teardown.

## Inbound rendering
EncryptedAttachment:
- fetches the authorized opaque asset descriptor;
- verifies ciphertext SHA-256;
- authenticates/decrypts AES-GCM locally;
- verifies plaintext size and SHA-256;
- creates a temporary object URL only after all checks pass.

Images and voice notes render from the local object URL. Files download from the locally reconstructed File. Object URLs are revoked on cleanup.

## Fail-closed behavior
Projected attachment metadata is validated again at the UI boundary.

Malformed metadata, asset-id mismatch, authentication failure or digest mismatch shows a generic unavailable state. The UI never falls back to rendering the server ciphertext URL.

Attachment and voice composition are also disabled while secure transport sync is blocked, preserving the Step 64 stale-epoch gate.

## Server boundary
No server crypto change was needed. Recipient asset access still relies on MessageAsset plus conversation membership authorization; plaintext reconstruction remains browser-only.

## Verification
The implementation is covered by the existing API ciphertext-asset boundary and is included in web typecheck/build CI. Live browser media/download smoke tests remain part of the production gate.

## Next
Step 66: make new direct/group creation MLS-aware and E2EE-only, then extend the same membership choreography to group add/remove flows.

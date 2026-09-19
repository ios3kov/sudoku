# Step 07 — Assets + Masked Web Push

## Goal

Add real media/file messages and notifications without exposing chat identity/content outside the private surface.

## Implemented

### Assets

- Immutable S3-compatible asset records.
- 25 MB per-file MVP limit.
- Narrow MIME allowlist: JPEG/PNG/WebP/GIF, PDF, plain text, selected audio/video formats.
- SVG, HTML, arbitrary executables, and generic binary uploads are rejected.
- Client computes SHA-256 before requesting an upload intent.
- API issues a short-lived signed PUT URL and records the expected digest/size/type.
- Completion verification reads the stored object server-side, recomputes SHA-256, checks exact size, and validates file signature/type before marking the asset `ready`.
- Failed integrity/type checks mark the asset `rejected`.
- Messages may attach only `ready` assets owned by the sender.
- Stable authenticated app URL: `/v1/assets/{asset_id}/content`; it authorizes access and redirects to a short-lived signed S3 GET URL.
- Non-media documents use `attachment` content disposition; safe raster/media types may render inline.
- Image/file rendering added to the mobile conversation UI.
- Offline text remains supported; attachment upload intentionally requires a connection.

### Push

- Per-device Web Push subscriptions stored server-side.
- VAPID public-key endpoint and client subscription flow.
- Message outbox publication schedules a separate Celery push task.
- Online users with an active presence TTL are not spammed with redundant push.
- HTTP 404/410 push endpoints are automatically revoked.
- Push payload contains only generic Sudoku text.
- The service worker ignores chat data and always renders a generic `Sudoku` notification.
- Notification clicks force an already-open private surface back to Sudoku before focus/navigation.

## Reliability

- Realtime publication and push scheduling happen only after the message transaction created a durable outbox event.
- Celery push task retries transient failures with backoff.
- Duplicate push delivery is visually collapsed by the service-worker notification tag.

## Security limitation

The MVP uses strict type allowlisting + server-side digest/signature verification, but it does not run a malware scanner. Before expanding the allowlist to office documents, archives, executables, or arbitrary uploads, production deployment must add an AV/sandbox quarantine pipeline.

## Verification

- Python source/migrations are syntax-compiled.
- Domain tests remain green.
- Full Next.js build still requires dependency installation in a network-enabled environment.

## Next step

Complete group-chat management, message edit/delete/reactions UI, voice-note capture, then add service-backed integration/E2E tests and deployment configuration.

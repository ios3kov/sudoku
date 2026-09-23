# Step 01 — Product Specification

## Goal

Define exactly what is being built before implementation.

## Decisions

- Product is an installable PWA named `Sudoku`.
- Normal UI is a genuine one-level Sudoku.
- Hidden entry gesture is tap a visible `5`, then swipe upward.
- Messenger remains protected by normal authentication even if the gesture is known.
- Access is invite-only.
- Push notifications never contain chat identity or message content.
- Backend is FastAPI/PostgreSQL; Redis is non-authoritative; Celery handles background jobs; assets use S3-compatible storage.

## Success criteria

- App can be installed to a phone home screen as Sudoku.
- Sudoku is genuinely playable.
- Accidental normal Sudoku gestures do not commonly unlock the hidden surface.
- Discovering the gesture alone cannot access conversation data.
- Message delivery architecture tolerates reconnects and duplicate client requests.

## Risks identified

- iOS PWA lifecycle/background limitations.
- Web Push support/permission variability.
- UI concealment can be mistaken for security.
- Offline retries can duplicate messages unless idempotency is designed from day one.
- Storage URLs can leak metadata unless signed and short-lived.

## Result

Specification accepted as the implementation baseline.


## Product evolution — 2026-09-23

The original PWA specification remains the historical baseline, but iPhone-specific platform limits now require a native iOS release track.

The product is therefore no longer PWA-only:

- Web/PWA remains supported.
- Native iOS adds contacts, biometrics, app-switcher privacy and native media/file capabilities.
- The same backend, phone identity, contact authorization and MLS protocol are shared by both clients.
- The native program does not change the core rule that Sudoku concealment is presentation only.
- Exactly one global administrator may exist, and only that administrator may create/revoke account invitations.

The active production/product specification for this extension is [Step88](88-native-ios-production-plan.md).

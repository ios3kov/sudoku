# Step 16 — Privacy Lifecycle Hardening

## Goal

Prevent the private messenger UI from remaining visible in an app-switcher/background snapshot while preserving the requested 30-second resume grace period.

## Changes

- Added `shouldLockPrivateSurface()` to the shared domain package.
- Added four domain tests for grace period, exact boundary, no timestamp and fail-closed invalid timing.
- Added a neutral pre-mounted Sudoku privacy cover.
- Backgrounding activates the cover synchronously through `html[data-private-hidden]`.
- The private surface is hidden and pointer-disabled while the cover is active.
- Returning before 30 seconds resumes the messenger.
- Returning after 30 seconds switches to Sudoku before the cover is removed.
- Push/service-worker forced hides use the same protected path.

## Security boundary

The cover is defense-in-depth for lifecycle/app-switcher snapshots. It is not a guarantee against screenshots or operating-system capture while the private screen is foregrounded.

## Verification

Repository CI is the acceptance gate for the TypeScript/domain/build changes.

## Next

Verify CI, then add a local-authentication gate (passkey/WebAuthn) so knowledge of the hidden gesture alone is insufficient to enter the private surface.

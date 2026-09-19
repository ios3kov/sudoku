# Step 26 — Code/security review: privacy lifecycle

## Finding
Acceptance is green through full API integration and domain tests. During code/security review, the complete source import was found to have regressed the earlier app-switcher privacy cover: private UI stayed rendered while the page was backgrounded and was only locked after returning if 30 seconds had elapsed.

## Fix
- Background/pagehide synchronously overlays a neutral Sudoku surface whenever private UI is active.
- Returning before 30 seconds removes the cover and preserves the authenticated private state.
- Returning after 30 seconds locks the private surface before the cover is removed.
- Service-worker forced-Sudoku messages use the same conceal-first behavior.
- The timing rule is isolated in the domain package for deterministic testing.

## Security meaning
This protects presentation in ordinary app-switcher/background lifecycle. It is not an anti-forensics guarantee and does not replace authentication.

## Next
Finish acceptance after the Step 25 type fixes and continue review of origin/CSRF, storage authorization, realtime membership and secret/log handling.

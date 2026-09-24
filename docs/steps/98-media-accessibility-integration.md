# Step 98 — integrated accessibility and media review

Date: 2026-09-24. Combines PRs #74–77 without discarding their commits.

The integration retains fixed mobile viewport text scaling, privacy-cover accessibility isolation, JPEG preparation, compact voice encoding and bounded native video export. The production plan preserves both media-storage and accessibility requirements. Physical-iPhone and complete accessibility acceptance remain open.

## Lint review

Fixed the typing callback dependency, removed an unused protocol type, and bound voice-preview resource cleanup to the exact audio element. Browser-only saved-phone initialization now happens when the login form mounts. Conversation state uses the existing parent conversation key instead of resetting the same state in an effect. Sudoku records completion from the final digit event and preserves that timestamp on reload. Group title changes synchronize before committing a render. Private attachment retry clears its error in the user action.

Narrow documented lint exceptions remain for deliberate synchronization with external API/realtime events and post-SSR browser storage hydration. These are reviewed exceptions, not a claim that every effect was eliminated. Private/blob images intentionally bypass server image optimization so plaintext/private URLs are not sent to an image optimizer. No rule is disabled globally. Web lint now fails on any new warning, including stale suppression directives.

## Verification

The integrated head must pass all five CI workflows, including the browser accessibility and media suites and native video simulator tests, before merging. A regression verifies that solving the last Sudoku cell records a stable completion timestamp across reload. Local full typecheck requires the CI-generated OpenMLS browser package.

No production deployment, migration, paid storage provisioning or store release is part of this integration. The landscape-video playback exception is the next implementation step. Device acceptance still needs full Xcode and a physical iPhone.

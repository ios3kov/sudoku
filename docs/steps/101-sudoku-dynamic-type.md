# Step 101 — Sudoku maximum Dynamic Type correction

Superseding status, 2026-09-24: PR #83 merged as `6ed009061ebf571c8078875ea230caee30fff33d` after all applicable CI checks passed. The operator closed further large-text work. The remaining maximum-text confirmation below is historical and is no longer requested. This is a scope decision, not full accessibility/VoiceOver or physical-device acceptance.

Date: 2026-09-24. Repository fix prepared after physical-iPhone evidence. Production remains unchanged.

## Physical finding

The operator enabled iOS **Larger Accessibility Sizes** at its maximum on the offline `Sudoku QA` build. The supplied iPhone 12 mini screenshot showed the requested text scaling, but exposed four defects in the new game: the fixed header became excessively tall, statistic labels overlapped or clipped, digits escaped their cells, and the lower controls were pushed out of the immediately visible area.

This is valid maximum-Dynamic-Type evidence, not user error. It does not close the accessibility checklist.

## Correction

The Sudoku screen continues to use the native `--sudoku-text-size` scale. Text that participates in flexible content can still grow. Text inside spatially fixed game elements now has readable pixel bounds:

- title, identity and header actions enlarge within the available phone width and the header may wrap;
- statistic labels and values remain inside their three columns;
- puzzle digits remain inside square cells at every board size;
- digit and action controls retain enlarged labels and a minimum 44-point target;
- the outer page remains fixed while only `.game-content` may scroll when the screen cannot contain the enlarged interface.

Whole-page zoom remains disabled per ADR-020. The change does not alter puzzle generation, saved games, the hold-5 gesture, authentication or messenger data.

## Verification

Added a browser regression at 320×693 and 300% root text. It requires no horizontal document overflow, cell and statistic containment, internal content scrolling on the constrained viewport, and reachable 44-point Pause, Menu, Notes and Hint controls.

Local lint and TypeScript checks passed. The task-local Playwright browser downloaded successfully but could not start inside the macOS command sandbox because its Mach rendezvous service was denied; this is not a product assertion. The rendered application was therefore checked through the Codex in-app browser using the same CSS scale:

- 320×693: the fixed outer page remained stable; the content pane provided the bounded scroll needed to reach all controls;
- 375×728: the complete 9×9 game, statistics, keypad and actions fit; all digits and labels were contained;
- measured document overflow was zero, grid-cell and label containment were true, and browser console warnings/errors were empty.

The corrected build still requires installation and operator confirmation at maximum iOS text size. VoiceOver, messenger flows, system pickers and the broader physical-device matrix remain open. Do not mark Accessibility/Dynamic Type/VoiceOver complete from this correction alone.

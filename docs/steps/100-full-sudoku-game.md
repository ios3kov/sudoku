# Step 100 — full Sudoku game and remembered startup

Date: 2026-09-24. Repository implementation prepared for review; browser CI and physical-device acceptance remain pending. No production deployment authorized.

## Product contract

Every visitor can play a complete Sudoku game without messenger authentication. The game offers a menu, grid size and difficulty selection, new puzzle, saved-game continuation, notes, erase, hints, undo/redo, pause/resume, elapsed time, mistake count and completion feedback. Generated puzzles must have exactly one solution. Gameplay and persistence work locally; opening a puzzle must not require a new backend endpoint or expose messenger data.

A first-time device opens the ordinary game menu. The existing hold-5 then upward-drag gesture is available from a 9×9 game even before messenger authentication, so the first login remains reachable. An ordinary tap on 5 enters a digit. Ordinary swipes must not move the whole game canvas. A 4×4 puzzle has no digit 5; the menu can always start a 9×9 puzzle.

Only successful entry into the authenticated messenger sets a device-local startup preference. Showing the login screen, validating a stored token in the background, or unfinished PIN onboarding must not set it. The preference contains no credentials and never grants access to messages. Locked and expired sessions still require existing authentication.

After that first entry, each cold application/page start opens a new random 9×9 puzzle directly. Temporary messenger navigation and privacy-cover transitions are not cold starts and must not replace the current puzzle. The saved unfinished game remains independently accessible from the menu; a new quick-start puzzle must not silently overwrite it. Full game menus remain available to all users. The preference survives normal sign-out; clearing app/browser data resets it. Unavailable or corrupt browser storage falls back safely.

The native application stays portrait-only, except the previously specified landscape-video player. Game content respects the notch/status bar and home indicator. Larger text and VoiceOver remain supported; constrained or enlarged layouts may scroll within their controls/menu where necessary without causing a document-level swipe or interfering with hold-5.

## Source and integration boundaries

Reference/source: [cnkang/sudoku](https://github.com/cnkang/sudoku), inspected revision `bb932683e27c2079a6d3ecf1e75a16b0ca0b827d`. Its MIT license is Copyright (c) 2024 Kang Liu; preserve the license and attribution for adapted code. Its README claims are not accepted as verification of our integration.

Adapt the Sudoku generation/game patterns into the existing React/Next.js and domain-package structure. Preserve the existing messenger, auth, MLS, native bridges, origin restrictions and privacy cover. Do not import upstream server authentication, deployment configuration, telemetry or unrelated dependencies. Validate uniqueness independently and keep generation bounded so a difficult puzzle cannot freeze the UI indefinitely.

## Delivery and validation

Separate changes cover native frame/scroll corrections, the game engine, the full game UI, and remembered startup integration. Each review records its exact commit and actual checks. Required checks include deterministic generation and solution validity for all sizes/difficulties, unique solutions, immutable givens, history/notes/hints, persistence corruption handling, pause/resume, completion, startup preference timing, continued saved game, hold-5 versus ordinary 5 input, and return/background privacy behavior. Existing messenger browser checks must remain meaningful after the new menu appears.

Real-iPhone checks include portrait layout on iPhone mini, no bottom seam, no whole-page rubber banding, menu access, keyboard/VoiceOver/Dynamic Type, cold launch after first login and secret reveal. Native compilation or unit tests do not close physical acceptance. The current native host loads the production origin, so unreleased game UI requires an explicitly scoped test environment or separately authorized production release before physical end-to-end acceptance.

## Native lower-edge correction

The operator confirmed that adding the launch-screen declaration removed black letterboxing and the board loads on a physical iPhone. A faint strip remained near the bottom on both Sudoku and messenger login; disabling native scroll-edge effects did not resolve it. Review identified a permanent idle CSS shadow and the separate 34-point native bottom region as relevant boundaries. The next correction removes the idle shadow and extends the native canvas to the bottom edge while preserving content safe-area padding. The updated native build launched on the physical iPhone. The operator subsequently reported that the remaining strip is visible only beneath the moving Sudoku screen during reveal. Remove the decorative reveal pseudo-element entirely, including its gesture-time shadow, in both web CSS and the native compatibility stylesheet. The operator then confirmed: the strip is gone and the result is correct, including the swipe. This specific visual defect is closed; overall physical acceptance stays open.

## Implemented repository scope

The domain engine generates 4×4, 6×6 and 9×9 puzzles with easy, medium and hard clue-density targets. Difficulty is not a human-technique rating. Bounded solution counting rejects multiple solutions and treats exhausted search budgets as unproven; only uniqueness-preserving clue removals are retained. Notes, hints, erase, immutable givens, bounded undo/redo history, pause and completed-board timing are handled in the domain model. Persisted games are strictly validated before rendering.

The public UI now includes size/difficulty choices, a new game, continuation, instructions, playing controls, pause and completion feedback. Reset lives in the game menu and returns to the same puzzle; starting a new puzzle explicitly replaces the saved slot. The game adapts its box boundaries and keypad to each size. The secret interaction remains attached to digit 5, so it is available on 6×6 and 9×9 boards; 4×4 users can choose a larger board through the menu.

`localStorage["sudoku:game:v3"]` stores one game. Ordinary menu-started and continued games autosave. A quick-start puzzle stays in the current page session without replacing that slot until the user explicitly saves it. The in-memory session survives private-surface and privacy-cover remounts. Background time does not count as playing time. Storage failures do not prevent gameplay and are surfaced when a save is attempted.

`localStorage["sudoku.startup.v1"] = "quick-play"` is written only when AuthGate has an active authenticated user, with session loading, PIN unlock and onboarding complete. A successful background session check alone does not set it. The flag changes presentation only; the existing cookie/session and device-access checks still protect the messenger. Missing, malformed or inaccessible preference storage opens the menu. No new backend endpoint or credential storage was added.

The previous single-puzzle `sudoku:level-1:v2` save is migrated when no valid new-format save exists. Migration validates values against the shipped givens, notes, mistakes and timestamps; malformed legacy saves are rejected. A valid v3 game always wins. The original legacy bytes are retained. If writing the migrated game fails, the validated game can still be continued in memory. The old wall-clock duration is converted once to elapsed seconds, using the completion time when present; subsequent timing counts active play only.

## Validation checkpoint

At the current working-tree checkpoint, 40 domain tests, 11 device-access tests and 5 saved-game migration tests passed. Web lint with zero warnings, web/domain type checking and the CSS class contract check passed. These are local results, not an exact-head CI claim; the final PR must record its reviewed commit and workflow results.

Browser tests have been adapted to enter a new game through the real public menu before performing hold-5 reveal. They do not forge authorization to skip the menu. The existing fixed-cell assumptions were replaced with generated-board selections, and the completion regression now validates the new saved timer across reload. Added coverage exercises small boards, notes/history/pause, saved-game continuation, quick-start preservation of the separate saved slot and the moment the authenticated-entry flag is written. Browser CI is still pending.

The operator confirmed absence of the lower seam after the final native correction. Full physical iPhone acceptance, VoiceOver/Dynamic Type acceptance, two-device messaging and production readiness remain open. Neither this checkpoint nor local compilation marks those gates complete.

## Review branches

PR #80 merged as `edab00091606ddf2abd9140beeddc54e91fba496` after all five workflows passed on `0ed946e212ba2b818ca0b427e2fc7f6a86ae5e7d`. PR #81 merged as `cd842d3c8c5ce70abd623a05cae502ff3afd016b` after all four applicable workflows passed on `dbcde73b21cacf66a39ea031f23bc5a71caae039` (the native workflow was path-filtered). Main after #80 was tree-identical to its tested head. The UI/startup work and final removal of the gesture-time shadow are in PR #82, retargeted to main; final exact-head CI is pending.

Manual in-app-browser verification at 375×728 covered 4×4, 6×6 and 9×9 layout, hard-mode selection, ordinary digit-5 entry, hints/undo/redo, pause/menu, notes and saved-game restoration after reload. No console warnings/errors were observed. This does not substitute for WKWebView or VoiceOver acceptance.

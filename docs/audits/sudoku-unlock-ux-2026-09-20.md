# Sudoku unlock interaction audit — 2026-09-20

## Scope
Targeted refactor, UX/UI audit, polish and performance review of the hidden Sudoku -> messenger transition discovered during live Step 70 testing.

## Correct interaction model
The previous implementation moved only the keypad digit `5` and showed a progress rail. That did not match the intended interaction.

The corrected interaction is:
1. press and hold keypad digit `5`;
2. drag upward without releasing;
3. the **entire Sudoku screen follows the finger upward 1:1**;
4. the actual private surface is revealed underneath, like an iPhone unlock/home-screen reveal;
5. releasing before the threshold smoothly returns the Sudoku screen to its original position;
6. releasing after a valid gesture completes the screen slide and leaves the private surface active.

The digit `5` is only the gesture handle. It does not animate independently from the Sudoku screen.

## UX/UI findings and fixes
- Removed the standalone moving-`5`/progress-rail metaphor.
- Added a layered reveal stage: private surface below, opaque Sudoku surface above.
- Preserved the compact 1–9 keypad row and existing Sudoku HUD.
- Added bottom-edge shadow while the Sudoku surface moves so the layer relationship is visually clear.
- The private layer is non-interactive and accessibility-hidden until the unlock completes.
- Incomplete drags spring back; meaningful aborted drags do not accidentally enter digit `5`.
- Reduced-motion preference shortens transition timing.
- Background/app-switch during a partial reveal immediately removes the private underlay and returns to the privacy cover.

## Performance review
The drag path is deliberately compositor-oriented:
- `pointermove` does **not** update React state;
- screen position is written through a CSS custom property inside `requestAnimationFrame`;
- only `transform` changes during the gesture;
- viewport height is sampled once on pointer down, not on every move;
- the private surface is mounted only after a real upward drag begins, so normal taps on `5` do not initialize the messenger;
- one forced layout is used only on successful release to guarantee a continuous finishing transition from the exact finger position.

This removes the main jank risk in the previous implementation: React re-rendering for every pointer event.

## Automated acceptance
Browser acceptance covers:
- 390 px mobile viewport;
- all digits 1–9 remain on one row at board width;
- short upward drag visibly moves the whole Sudoku screen;
- private layer appears underneath;
- short drag returns to the original screen position and removes the underlay;
- valid drag reveals the private auth/messenger surface;
- existing MLS reload/offline acceptance uses the same gesture;
- background/privacy cover behavior remains enforced.

## Remaining live checks
Automated tests do not replace real-device profiling. Step 70 still requires:
- iOS Safari/installed PWA gesture smoothness and safe-area check;
- Android Chromium/installed PWA gesture smoothness;
- invite acceptance on the second account;
- persistence/reboot, destructive backup/restore and remaining two-device MLS checks.

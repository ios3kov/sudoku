# Sudoku unlock polish and gameplay regression audit — 2026-09-21

## Trigger

Physical-device testing of the PR #25 production candidate confirmed that the whole Sudoku screen now slides upward to expose the private surface. Two regressions remained:

1. the release/return motion did not yet feel smooth enough compared with an iPhone-style unlock;
2. the Sudoku keypad could reject conflict-producing values, making ordinary digits appear broken even though the cover is supposed to remain a fully functional game.

## Interaction target

The hidden interaction must not turn Sudoku into a decorative lock screen.

Expected behavior:
- tap any digit 1–9 to play Sudoku normally;
- a normal tap on digit 5 must still enter 5 into the selected editable cell;
- press/hold 5 and drag upward to move the **entire Sudoku surface**;
- the private surface is physically underneath the Sudoku surface;
- incomplete drag settles back smoothly;
- a valid drag continues from the exact finger position and settles offscreen without a visible jump;
- app backgrounding during any phase must conceal private content.

## Smoothness findings

The first full-screen implementation still had a visible hitch because the private React tree was mounted only after drag movement began. That can make the first compositor frames compete with session checks, messenger initialization and encrypted-state setup.

The release animation also used one fixed CSS transition from a relatively short gesture distance to a full-screen exit. It worked functionally but did not preserve the direct-manipulation feel through the release phase.

## Motion fixes

The follow-up implementation:
- keeps the private surface mounted below the opaque Sudoku cover;
- keeps it `inert`, `aria-hidden` and non-interactive until the unlock actually completes;
- performs no React state update for pointer movement;
- batches finger-following transform writes through `requestAnimationFrame`;
- moves the Sudoku surface with `translate3d` only;
- applies a lightweight scale/vertical parallax/opacity reveal to the underlay;
- derives successful settle duration from remaining travel and recent upward velocity;
- uses an ease-out curve for completion and a slower spring-like curve for snapback;
- clears partial-reveal state on the privacy lifecycle by replacing the visual tree with the Sudoku privacy cover when the page is hidden.

The deliberate trade-off is that an authenticated private surface can stay warm underneath Sudoku while the page is visible. This improves first-gesture latency. It does not change the documented security model: the hidden Sudoku layer is presentation privacy, while authentication/authorization/E2EE remain the actual security boundary.

## Sudoku gameplay finding

The keypad called `canPlace()` before updating an editable cell. Conflict-producing values were silently refused. That behavior is too restrictive for a normal Sudoku UI and can look like dead buttons.

The game now:
- accepts every digit 1–9 in any editable cell;
- keeps givens immutable;
- marks wrong/conflicting entries through the existing error styling;
- increments the mistake counter for a changed wrong answer;
- keeps Erase, Notes, Clear and Reset behavior;
- preserves normal tap behavior for digit 5 while reserving only its upward drag for the hidden interaction.

## Automated acceptance

Mobile Chromium acceptance now verifies:
- 390 px mobile viewport;
- digits 1–9 stay on one row at board width;
- every digit 1–9 can be entered into an editable cell;
- normal digit-5 tap does not unlock the private surface;
- Erase works;
- Notes mode works;
- Reset clears editable progress;
- givens cannot be overwritten;
- short upward drag moves the whole Sudoku surface and settles back;
- successful drag exposes the private surface;
- private layer stays inert until unlock;
- app-switch privacy cover remains enforced.

The existing MLS browser acceptance continues to exercise the same unlock path before secure-chat login/recovery.

## Live stop rule

Do not call this interaction closed from CI alone. After merge/deploy, repeat on a physical iPhone:
- slow drag;
- fast drag;
- partial drag and release;
- ordinary tap on 5;
- ordinary taps on all other digits;
- Notes/Erase/Reset;
- background the app during a partial drag.

The fix passes only when the motion feels continuous and the Sudoku remains fully playable.


## Physical-device follow-up — grid integrity and 50% handoff

Live iPhone testing after PR #26 exposed two more concrete issues.

### Sudoku grid corruption

Wrong cells used the generic CSS class `error`. That class is also used for form-level errors and adds margin, padding, border radius and a smaller font size. When applied to a grid cell, those layout properties distort the CSS Grid track and expose the dark board background as thick horizontal/vertical bands.

Fix:
- Sudoku cells now use a dedicated `invalid` state class;
- invalid cells change only visual error color/background;
- no margin, padding, radius or font-size mutation is inherited from form errors;
- browser acceptance checks invalid-cell geometry and board dimensions after a wrong entry.

### Unlock threshold

The previous gesture still completed after a short upward movement because it reused the old fixed-pixel unlock rule.

The new rule is progress based:
- the full gesture path is the available vertical distance from the pressed digit `5` to the top edge of the viewport;
- the Sudoku surface follows the finger for the entire drag;
- below 50% progress, release returns the Sudoku surface;
- at 50% progress, the gesture hands off to the finishing animation and completes the remaining 50%;
- a normal tap on `5` remains ordinary Sudoku input.

This makes the hidden transition deliberate and prevents short accidental reveals.


## Mobile scale follow-up

Physical iPhone feedback also requires the private messenger to keep a constant visual scale while typing.

The fix uses two layers:
- viewport is pinned to scale 1 with no user/focus zoom;
- text inputs and textareas are explicitly 16px, preventing Safari's automatic focus zoom trigger.

Acceptance verifies the rendered login input font size and viewport metadata. Physical iPhone verification remains required because desktop Chromium does not emulate Safari's visual-viewport zoom behavior exactly.

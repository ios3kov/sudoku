# Sudoku UI Redesign

Branch: `design/sudoku-ui-redesign`

## Scope

Only the public Sudoku game surface is redesigned here. Messenger behavior, authentication and E2EE are out of scope.

## Layout reference

We use the established Sudoku.com-style information hierarchy as a structural reference only:

1. compact header;
2. difficulty / timer / mistakes status;
3. dominant puzzle board;
4. action row;
5. number keypad.

All visual assets, colors, branding, typography and final component artwork are original SUDOKU.MOSCOW work.

## Current baseline

- gameplay controls changed from a side-column arrangement to two clean rows;
- actions sit in a dedicated row;
- digits use one horizontal row sized to the board size (4 / 6 / 9);
- board is the dominant visual block;
- header and stats are compact;
- first-pass dark navy / gold SUDOKU.MOSCOW styling added;
- existing gameplay logic and secret messenger gesture are preserved.

## Next pass

Redraw and approve elements individually:

1. Splash
2. Main menu
3. Header / HUD
4. Board frame and cell states
5. Action buttons
6. Number keypad
7. Pause
8. Win / Lose
9. Difficulty / mode setup

No merge to `main` until the redesign is explicitly approved.


## Geometry pass — approved reference

Implemented the exact approved gameplay hierarchy:

- full outer gold frame around the gameplay surface;
- header with menu / centered SUDOKU.MOSCOW / pause;
- centered decorative divider placeholder under the header;
- three framed HUD cards for Difficulty / Timer / Mistakes;
- dominant 9×9 board with gold 3×3 separators and framed perimeter;
- selected/error cell uses the approved red state;
- bottom controls are now a strict 4×3 matrix:
  - row 1: Undo / 1 / 2 / 3
  - row 2: Erase / 4 / 5 / 6
  - row 3: Notes / 7 / 8 / 9
- Notes active state uses bright blue;
- the entire composition scales down as a unit on shorter/narrower screens.

This pass intentionally uses CSS placeholder ornament. Final gold frame pieces, corners, star divider and button skins will be replaced with optimized artwork after geometry approval.

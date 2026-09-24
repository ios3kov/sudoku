# Third-party notices

## cnkang/sudoku

Source: https://github.com/cnkang/sudoku

Reviewed revision: `bb932683e27c2079a6d3ecf1e75a16b0ca0b827d`.

`packages/domain/src/sudoku-game.ts` adapts the uniqueness-preserving clue-removal approach from `src/app/api/solveSudoku/sudokuGenerator.ts`. The local implementation uses flat grids, seeded randomization and a bounded browser solver instead of Node crypto, server requests and DLX. The game UI is implemented in this repository; no upstream assets or server endpoints are required. Difficulty labels describe clue-density targets, not a guarantee of human solving technique.

MIT License

Copyright (c) 2024 Kang Liu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

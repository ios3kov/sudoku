import test from "node:test";
import assert from "node:assert/strict";
import { candidatesFor, conflictsFor, isSolved, isValidGrid, parseGrid } from "../dist/sudoku.js";

const puzzle = parseGrid(`
53..7....
6..195...
.98....6.
8...6...3
4..8.3..1
7...2...6
.6....28.
...419..5
....8..79
`);

const solution = parseGrid(`
534678912
672195348
198342567
859761423
426853791
713924856
961537284
287419635
345286179
`);

test("puzzle is valid", () => assert.equal(isValidGrid(puzzle), true));
test("solution is recognized", () => assert.equal(isSolved(solution, solution), true));
test("candidates are calculated from peers", () => assert.deepEqual(candidatesFor(puzzle, 2), [1, 2, 4]));
test("conflicts identify duplicate value", () => assert.ok(conflictsFor(puzzle, 2, 5).length > 0));

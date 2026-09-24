import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSudokuGame, generateGamePuzzle } from '../packages/domain/dist/index.js';
import { migrateLegacySudokuGame, readSavedSudokuGame, SUDOKU_GAME_STORAGE_KEY, LEGACY_SUDOKU_STORAGE_KEY } from '../apps/web/features/sudoku/saved-game.ts';
const givens = '530070000600195000098000060800060003400803001700020006060000280000419005000080079'.split('').map(Number);
const solution = '534678912672195348198342567859761423426853791713924856961537284287419635345286179'.split('').map(Number);
const puzzle = {givens, solution};
const now = 1000000;
function fixture() { const grid = [...givens]; grid[2] = 4; return {grid, notes:{3:[6,2]}, mistakes:3, startedAt:now-91000, completedAt:null}; }
function storage(entries, readOnly = false) { const map = new Map(entries); return {map, getItem:key=>map.get(key)??null, setItem:(key,value)=>{if(readOnly)throw Error('Quota');map.set(key,value);}}; }

test('legacy migration preserves moves, notes, mistakes and displayed time without mutating input', () => {
  const old = fixture(), original = structuredClone(old);
  const migrated = migrateLegacySudokuGame(old, puzzle, now);
  assert.deepEqual(migrated.values, old.grid);
  assert.deepEqual(migrated.notes[3], [2,6]);
  assert.equal(migrated.mistakes,3);
  assert.equal(migrated.elapsedSeconds,91);
  assert.deepEqual(old,original);
});
test('completed legacy game retains its stopped elapsed time', () => {
  const game = migrateLegacySudokuGame({grid:solution, notes:{}, startedAt:1000, completedAt:91000}, puzzle, now);
  assert.equal(game.elapsedSeconds,90);
});
test('migration rejects changed givens, invalid digits, notes and timestamps', () => {
  const corrupt = fixture(); corrupt.grid[0] = 1;
  for(const old of [corrupt, {...fixture(),grid:Array(81).fill(10)}, {...fixture(),notes:{3:[2,2]}}, {...fixture(),notes:{81:[2]}}, {...fixture(),mistakes:-1}, {...fixture(),startedAt:now+1}, {...fixture(),completedAt:now}]) {
    assert.equal(migrateLegacySudokuGame(old,puzzle,now),null);
  }
});
test('a valid current game always takes precedence; legacy bytes remain untouched', () => {
  const current = createSudokuGame(generateGamePuzzle(4,'easy',3)), old = JSON.stringify(fixture());
  const store = storage([[SUDOKU_GAME_STORAGE_KEY,JSON.stringify(current)], [LEGACY_SUDOKU_STORAGE_KEY,old]]);
  assert.deepEqual(readSavedSudokuGame(store,puzzle,now),current);
  assert.equal(store.getItem(LEGACY_SUDOKU_STORAGE_KEY),old);
});
test('missing or corrupt current saves migrate legacy, preserving rollback bytes and tolerating quota errors', () => {
  for(const current of [undefined,'{broken','{}']) for(const readOnly of [false,true]) {
    const old = JSON.stringify(fixture());
    const store = storage([[LEGACY_SUDOKU_STORAGE_KEY,old], ...(current?[[SUDOKU_GAME_STORAGE_KEY,current]]:[])],readOnly);
    const result = readSavedSudokuGame(store,puzzle,now);
    assert.equal(result.elapsedSeconds,91);
    assert.equal(store.getItem(LEGACY_SUDOKU_STORAGE_KEY),old);
    if(!readOnly) assert.deepEqual(JSON.parse(store.getItem(SUDOKU_GAME_STORAGE_KEY)),result);
  }
});

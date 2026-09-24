import { createSudokuGame, parseSudokuGame, type SudokuGame } from "@sudoku/domain";

export const SUDOKU_GAME_STORAGE_KEY = "sudoku:game:v3";
export const LEGACY_SUDOKU_STORAGE_KEY = "sudoku:level-1:v2";
type LegacyPuzzle = { givens: readonly number[]; solution: readonly number[] };

/** The shipped fixed puzzle is supplied explicitly, so legacy data cannot redefine its givens. */
export function migrateLegacySudokuGame(input: unknown, puzzle: LegacyPuzzle, now: number): SudokuGame | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const legacy = input as Record<string, unknown>;
  const grid = legacy.grid;
  if (!Array.isArray(grid) || grid.length !== 81 || grid.some(value => !Number.isInteger(value) || value < 0 || value > 9)) return null;
  if (puzzle.givens.length !== 81 || puzzle.givens.some((value, index) => value !== 0 && grid[index] !== value)) return null;
  const notes = Array.from({length: 81}, (): number[] => []);
  if (legacy.notes !== undefined) {
    if (!legacy.notes || typeof legacy.notes !== "object" || Array.isArray(legacy.notes)) return null;
    for (const [key, value] of Object.entries(legacy.notes)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= 81 || String(index) !== key || !Array.isArray(value)) return null;
      if (value.length > 9 || new Set(value).size !== value.length || value.some(n => !Number.isInteger(n) || n < 1 || n > 9)) return null;
      if (grid[index] !== 0 && value.length) return null;
      notes[index] = [...value].sort((a,b) => a-b);
    }
  }
  const mistakes = legacy.mistakes ?? 0;
  if (typeof mistakes !== "number" || !Number.isSafeInteger(mistakes) || mistakes < 0 || mistakes > 31536000) return null;
  const validTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= now;
  const start = legacy.startedAt;
  const end = legacy.completedAt;
  if (start != null && !validTimestamp(start)) return null;
  if (end != null && (!validTimestamp(end) || (typeof start === "number" && end < start))) return null;
  const complete = grid.every((value, index) => value === puzzle.solution[index]);
  if (end != null && !complete) return null;
  const game = createSudokuGame({size:9, difficulty:"medium", seed:1171, givens:[...puzzle.givens], solution:[...puzzle.solution]});
  game.values = [...grid];
  game.notes = notes;
  game.mistakes = mistakes;
  // Preserve the old wall-clock display once. Further timing counts active play only.
  game.elapsedSeconds = typeof start === "number" ? Math.min(31536000, Math.floor(((typeof end === "number" ? end : now) - start) / 1000)) : 0;
  return parseSudokuGame(game);
}

export function readSavedSudokuGame(storage: Pick<Storage, "getItem" | "setItem">, puzzle: LegacyPuzzle, now = Date.now()): SudokuGame | null {
  try {
    const current = storage.getItem(SUDOKU_GAME_STORAGE_KEY);
    if (current && current.length <= 1_000_000) {
      try {
        const parsed = parseSudokuGame(JSON.parse(current));
        if (parsed) return parsed;
      } catch { /* An invalid new-format save must not hide a valid legacy save. */ }
    }
    const legacy = storage.getItem(LEGACY_SUDOKU_STORAGE_KEY);
    if (!legacy || legacy.length > 100_000) return null;
    const migrated = migrateLegacySudokuGame(JSON.parse(legacy), puzzle, now);
    if (!migrated) return null;
    try { storage.setItem(SUDOKU_GAME_STORAGE_KEY, JSON.stringify(migrated)); } catch { /* Still offer the validated game for this visit. */ }
    // Retain the original bytes for rollback, even after a successful migration.
    return migrated;
  } catch {
    return null;
  }
}

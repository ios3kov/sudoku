// A device-local presentation preference, never an authorization signal.
// Read once when the client starts; changing it must not interrupt a game.
export const SUDOKU_STARTUP_PREFERENCE_KEY = "sudoku.startup.v1";
export type SudokuStartupPreference = "menu" | "quick-play";

export function readSudokuStartupPreference(): SudokuStartupPreference {
  try {
    return localStorage.getItem(SUDOKU_STARTUP_PREFERENCE_KEY) === "quick-play" ? "quick-play" : "menu";
  } catch {
    // SSR, disabled storage, and unavailable browser storage use the game menu.
    return "menu";
  }
}

// Call only after an authenticated messenger surface becomes active. Keep this
// preference across logout/lock; neither reading nor writing it grants access.
export function rememberMessengerEntry(): void {
  try {
    localStorage.setItem(SUDOKU_STARTUP_PREFERENCE_KEY, "quick-play");
  } catch {
    // Storage policy must never prevent signing in or playing Sudoku.
  }
}

import { expect, type Page } from "@playwright/test";

// Exercise the public game menu instead of pretending this browser has already
// authenticated. Returning users may already be on their quick-play board.
export async function ensureSudokuGame(page: Page) {
  const board = page.getByRole("grid", { name: "Sudoku board" });
  const newGame = page.getByRole("button", { name: "Free Mode", exact: true });
  await expect(board.or(newGame).first()).toBeVisible();
  if (!(await board.isVisible())) {
    await newGame.click();
    await page.getByRole("button", {name:"Start game", exact:true}).click();
  }
  await expect(board).toBeVisible();
}

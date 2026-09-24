import { expect, test } from "@playwright/test";

test("full game menu supports small boards, notes, history and pause", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "4×4", exact: true }).click();
  await page.getByRole("button", { name: "New game", exact: true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(16);
  const empty = page.locator(".cell:not(.given)").first();
  await empty.click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.locator(".digit").first().click();
  await expect(empty).toHaveAttribute("aria-label", /notes 1/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(empty).not.toHaveAttribute("aria-label", /notes/);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(empty).toHaveAttribute("aria-label", /notes 1/);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("grid")).toHaveCount(0);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(16);
  await page.reload();
  await page.getByRole("button", { name: /Continue saved game/ }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(16);
  await expect(page.locator(".cell:not(.given)").first()).toHaveAttribute("aria-label", /notes 1/);
});

test("quick startup preserves the separate saved game across cold launches", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "6×6", exact: true }).click();
  await page.getByRole("button", { name: "New game", exact: true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(36);
  await page.evaluate(() => localStorage.setItem("sudoku.startup.v1", "quick-play"));
  await page.reload();
  await expect(page.getByRole("gridcell")).toHaveCount(81);
  const firstSeed = await page.evaluate(() => JSON.parse(localStorage.getItem("sudoku:game:v3")!).puzzle.seed);
  await page.locator(".cell:not(.given)").first().click();
  await page.getByRole("button", { name: /^Hint/ }).click();
  await page.reload();
  await expect(page.getByRole("gridcell")).toHaveCount(81);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sudoku:game:v3")!).puzzle.seed)).toBe(firstSeed);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: /Continue saved game/ }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(36);
});

test("restoring a suspended page does not add the suspension to playing time", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New game", exact: true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(81);
  await page.evaluate(() => {
    // Model suspension: monotonic time advances without interval callbacks,
    // then the browser announces restoration before the next callback.
    const originalNow = performance.now.bind(performance);
    performance.now = () => originalNow() + 120_000;
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  const time = page.locator(".sudoku-stats strong").first();
  await expect.poll(async () => {
    const [minutes, seconds] = (await time.innerText()).split(":").map(Number);
    return minutes! * 60 + seconds!;
  }).toBeGreaterThan(0);
  const [minutes, seconds] = (await time.innerText()).split(":").map(Number);
  expect(minutes! * 60 + seconds!).toBeLessThan(10);
});

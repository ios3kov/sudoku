import { expect, test } from "@playwright/test";

test("maximum Dynamic Type keeps the game inside a narrow phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 693 });
  await page.goto("/");
  await page.getByRole("button", { name: "Free Mode", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--sudoku-text-size", "300%");
    window.dispatchEvent(new Event("sudoku:text-size-changed"));
  });

  await expect(page.getByRole("grid", { name: "Sudoku board" })).toBeVisible();
  const geometry = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".game-content")!;
    const board = document.querySelector<HTMLElement>(".board")!;
    const cells = [...document.querySelectorAll<HTMLElement>(".cell")];
    const stats = [...document.querySelectorAll<HTMLElement>(".sudoku-stats > div")];
    const labels = [...document.querySelectorAll<HTMLElement>(".sudoku-stats span")];
    return {
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      contentScrollable: content.scrollHeight > content.clientHeight,
      boardWidth: board.getBoundingClientRect().width,
      cellsContained: cells.every(cell => cell.scrollWidth <= cell.clientWidth + 1 && cell.scrollHeight <= cell.clientHeight + 1),
      labelsContained: labels.every((label, index) => label.scrollWidth <= stats[index]!.clientWidth + 1),
    };
  });
  expect(geometry.documentOverflow).toBeLessThanOrEqual(0);
  expect(geometry.contentScrollable).toBe(false);
  expect(geometry.boardWidth).toBeLessThanOrEqual(300);
  expect(geometry.cellsContained).toBe(true);
  expect(geometry.labelsContained).toBe(true);

  for (const name of ["Pause", "Menu", "Notes", "Erase"]) {
    const control = page.getByRole("button", { name, exact: true });
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
});

test("full game menu supports small boards, notes, history and pause", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Free Mode", exact: true }).click();
  await page.getByRole("button", { name: "4×4", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(16);
  const empty = page.locator(".cell:not(.given)").first();
  await empty.click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.locator(".digit").first().click();
  await expect(empty).toHaveAttribute("aria-label", /notes 1/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(empty).not.toHaveAttribute("aria-label", /notes/);
  await page.locator(".digit").first().click();
  await expect(empty).toHaveAttribute("aria-label", /notes 1/);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("dialog", {name:"Paused"})).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(16);
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact:true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(16);
  await expect(page.locator(".cell:not(.given)").first()).toHaveAttribute("aria-label", /notes 1/);
});

test("quick startup preserves the separate saved game across cold launches", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Free Mode", exact: true }).click();
  await page.getByRole("button", { name: "6×6", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(36);
  await page.evaluate(() => localStorage.setItem("sudoku.startup.v1", "quick-play"));
  await page.reload();
  await expect(page.getByRole("gridcell")).toHaveCount(81);
  const firstSeed = await page.evaluate(() => JSON.parse(localStorage.getItem("sudoku:game:v3")!).puzzle.seed);
  await page.locator(".cell:not(.given)").first().click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.locator(".digit").first().click();
  await page.reload();
  await expect(page.getByRole("gridcell")).toHaveCount(81);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sudoku:game:v3")!).puzzle.seed)).toBe(firstSeed);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Saved game", exact:true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(36);
});

test("restoring a suspended page does not add the suspension to playing time", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Free Mode", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.getByRole("gridcell")).toHaveCount(81);
  await page.evaluate(() => {
    // Model suspension: monotonic time advances without interval callbacks,
    // then the browser announces restoration before the next callback.
    const originalNow = performance.now.bind(performance);
    performance.now = () => originalNow() + 120_000;
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  const time = page.locator(".sudoku-stats strong").nth(1);
  await expect.poll(async () => {
    const [minutes, seconds] = (await time.innerText()).split(":").map(Number);
    return minutes! * 60 + seconds!;
  }).toBeGreaterThan(0);
  const [minutes, seconds] = (await time.innerText()).split(":").map(Number);
  expect(minutes! * 60 + seconds!).toBeLessThan(10);
});


test("messenger reveal waits for release instead of auto-finishing mid-drag", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Free Mode", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();

  const five = page.getByRole("button", { name: "5", exact: true });
  const box = await five.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;

  await five.dispatchEvent("pointerdown", {
    clientX: x,
    clientY: y,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await five.dispatchEvent("pointermove", {
    clientX: x,
    clientY: y * 0.4,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });

  await expect(page.locator(".private-reveal-layer")).toHaveAttribute("inert", "");
  await expect(page.locator(".sudoku-reveal-screen")).toHaveClass(/is-dragging/);

  await five.dispatchEvent("pointerup", {
    clientX: x,
    clientY: y * 0.4,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
  });

  await expect(page.locator(".private-reveal-layer")).not.toHaveAttribute("inert", "");
});

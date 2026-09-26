import { expect, test, type Page } from "@playwright/test";
import { ensureSudokuGame } from "./support/sudoku-start";
import { shouldCancelBeforeArm, shouldCommitReveal } from "../../features/secret-unlock/secret-unlock-motion";

test("pure reveal gesture policy distinguishes tap, cancel, threshold and velocity commit", () => {
  expect(shouldCancelBeforeArm(8, 8)).toBe(false);
  expect(shouldCancelBeforeArm(20, 0)).toBe(true);
  expect(shouldCommitReveal(99, 100, 0)).toBe(false);
  expect(shouldCommitReveal(100, 100, 0)).toBe(true);
  expect(shouldCommitReveal(80, 140, 0.8)).toBe(true);
  expect(shouldCommitReveal(60, 140, 1.2)).toBe(false);
});

async function dragFive(page: Page, progress: number, pointerId: number) {
  const five = page.getByRole("button", { name: "5", exact: true });
  const box = await five.boundingBox();
  expect(box).not.toBeNull();

  const startX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const startY = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  const targetY = Math.max(0, startY * (1 - progress));

  await five.dispatchEvent("pointerdown", {
    clientX: startX,
    clientY: startY,
    pointerId,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await page.waitForTimeout(110);
  await five.dispatchEvent("pointermove", {
    clientX: startX + 16,
    clientY: targetY,
    pointerId,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });

  return { five, startX, startY, targetY };
}

async function unlockPrivate(page: Page) {
  const drag = await dragFive(page, 0.55, 7);
  await drag.five.dispatchEvent("pointerup", {
    clientX: drag.startX + 16,
    clientY: drag.targetY,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
  });
}

test("only a touch that starts on digit 5 can arm the reveal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await ensureSudokuGame(page);

  const four = page.getByRole("button", { name: "4", exact: true });
  const box = await four.boundingBox();
  expect(box).not.toBeNull();
  const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;

  await four.dispatchEvent("pointerdown", {
    clientX: x,
    clientY: y,
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await page.waitForTimeout(120);
  await four.dispatchEvent("pointermove", {
    clientX: x + 8,
    clientY: Math.max(0, y * 0.35),
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await four.dispatchEvent("pointerup", {
    clientX: x + 8,
    clientY: Math.max(0, y * 0.35),
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
  });

  await expect(page.locator(".private-reveal-layer")).toHaveAttribute("inert", "");
  await expect.poll(
    () => page.locator(".sudoku-reveal-screen").evaluate((element) =>
      Math.round(element.getBoundingClientRect().top)),
  ).toBe(0);
});

test("mobile Sudoku stays compact and unlock slides the whole screen over chat", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await ensureSudokuGame(page);

  await expect(page.getByRole("grid", { name: "Sudoku board" })).toBeVisible();
  await expect(page.locator(".sudoku-header-actions")).toContainText("SUDOKU.MOSCOW");
  await expect(page.getByText("Timer", { exact: true })).toBeVisible();
  await expect(page.getByText("Mistakes", { exact: true })).toBeVisible();
  await expect(page.getByText("Difficulty", { exact: true })).toBeVisible();

  const digitButtons = page.locator(".digits .digit");
  await expect(digitButtons).toHaveCount(9);
  const digitBoxes = await digitButtons.evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { top: Math.round(rect.top), left: rect.left, right: rect.right };
    }),
  );
  expect(new Set(digitBoxes.map((box) => box.top)).size).toBe(3);

  const boardBox = await page.getByRole("grid", { name: "Sudoku board" }).boundingBox();
  expect(boardBox).not.toBeNull();
  expect(Math.abs((digitBoxes.at(-1)?.right ?? 0) - (boardBox?.x ?? 0) - (boardBox?.width ?? 0))).toBeLessThanOrEqual(2);
  expect(digitBoxes[0]!.left).toBeGreaterThan(boardBox!.x);

  const initialOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(initialOverflow).toBeLessThanOrEqual(1);

  const unnamedButtons = await page.locator("button:visible").evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const label = button.getAttribute("aria-label")?.trim();
        const title = button.getAttribute("title")?.trim();
        const text = button.textContent?.trim();
        return !label && !title && !text;
      })
      .length,
  );
  expect(unnamedButtons).toBe(0);

  // The cover is a real Sudoku, not a decorative unlock screen. Every keypad
  // digit, including 5, must remain usable for ordinary play.
  const editableCell = page.locator('[role="gridcell"]:not(.given)').first();
  let checkedInvalidGeometry = false;
  await editableCell.click();
  for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
    await expect(editableCell).toHaveText(digit);
    await expect(page.locator(".private-reveal-layer")).toHaveAttribute("inert", "");

    if (!checkedInvalidGeometry && /invalid/.test(await editableCell.getAttribute("class") ?? "")) {
      checkedInvalidGeometry = true;
      await expect(editableCell).toHaveClass(/invalid/);
      const invalidGeometry = await editableCell.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          marginTop: style.marginTop,
          marginBottom: style.marginBottom,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          borderRadius: style.borderRadius,
          width: rect.width,
          height: rect.height,
        };
      });
      expect(invalidGeometry.marginTop).toBe("0px");
      expect(invalidGeometry.marginBottom).toBe("0px");
      expect(invalidGeometry.paddingTop).toBe("0px");
      expect(invalidGeometry.paddingBottom).toBe("0px");
      expect(invalidGeometry.borderRadius).toBe("0px");
      expect(Math.abs(invalidGeometry.width - invalidGeometry.height)).toBeLessThanOrEqual(1);

      const boardAfterInvalid = await page.getByRole("grid", { name: "Sudoku board" }).boundingBox();
      expect(boardAfterInvalid).not.toBeNull();
      expect(Math.abs((boardAfterInvalid?.height ?? 0) - (boardBox?.height ?? 0))).toBeLessThanOrEqual(1);
    }
  }

  expect(checkedInvalidGeometry).toBe(true);
  await page.getByRole("button", { name: "Erase", exact: true }).click();
  await expect(editableCell).toHaveText("");

  await expect(editableCell).toHaveAttribute("aria-selected", "true");
  // Erase preserves selection; the redesigned toolbar has no Clear control.

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(editableCell).toContainText("2");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(editableCell).toContainText("2");
  await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0);
  await editableCell.click();
  await page.getByRole("button", { name: "Erase", exact: true }).click();
  await expect(editableCell).toHaveText("");

  const givenCell = page.locator('[role="gridcell"].given').first();
  const givenValue = await givenCell.textContent();
  await givenCell.click();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(givenCell).toHaveText(givenValue!);

  // 49% is deliberately below the unlock threshold. After the hold arms,
  // the screen follows the finger and a settled release returns to Sudoku.
  const belowThreshold = await dragFive(page, 0.49, 6);
  await expect(page.locator(".private-reveal-layer")).toBeVisible();
  // Pointer moves publish their transform on requestAnimationFrame. The
  // underlay is already visible while inert, so it is not a frame barrier.
  // Observe the same geometry condition rather than sampling before paint.
  await expect.poll(
    () => page.locator(".sudoku-reveal-screen").evaluate(
      (element) => element.getBoundingClientRect().top,
    ),
    { timeout: 2_000 },
  ).toBeLessThan(-100);
  await expect(page.locator(".private-reveal-layer")).toHaveAttribute("inert", "");
  await page.waitForTimeout(160);
  await belowThreshold.five.dispatchEvent("pointerup", {
    clientX: belowThreshold.startX + 16,
    clientY: belowThreshold.targetY,
    pointerId: 6,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
  });
  await expect(page.locator(".private-reveal-layer")).toHaveAttribute("inert", "", {
    timeout: 2_000,
  });
  await expect.poll(
    () =>
      page.locator(".sudoku-reveal-screen").evaluate(
        (element) => Math.round(element.getBoundingClientRect().top),
      ),
    { timeout: 2_000 },
  ).toBe(0);

  await unlockPrivate(page);
  const phone = page.getByLabel("Phone number", { exact: true });
  await expect(phone).toBeVisible({ timeout: 30_000 });
  await expect(phone).toHaveCSS("font-size", "16px");
  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewportMeta).toContain("maximum-scale=1");
  expect(viewportMeta).toContain("user-scalable=no");

  const privateOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(privateOverflow).toBeLessThanOrEqual(1);

  await expect(page.locator(".private-reveal-layer")).not.toHaveAttribute("inert", "", { timeout: 5_000 });
  await phone.focus();
  await expect(phone).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox", { name: "Remember phone on this device", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(page.getByRole("heading", { name: "Sudoku" })).toBeVisible();
  await expect(page.locator(".privacy-grid")).toBeVisible();
});


test("solving the last Sudoku cell freezes the saved timer across reload", async ({ page }) => {
  // A valid unique near-complete puzzle gives this regression a deterministic
  // last move without coupling ordinary play to one shipped puzzle.
  const solution = "534678912672195348198342567859761423426853791713924856961537284287419635345286179".split("").map(Number);
  const index = 2;
  const givens = [...solution];
  givens[index] = 0;
  await page.addInitScript(({ solution, givens }) => {
    if (sessionStorage.getItem("completion-fixture-seeded")) return;
    sessionStorage.setItem("completion-fixture-seeded", "1");
    localStorage.setItem("sudoku:game:v3", JSON.stringify({
      version: 1,
      puzzle: { size: 9, difficulty: "easy", seed: 1171, givens, solution },
      values: givens, notes: givens.map(() => []), mistakes: 0, hints: 0,
      elapsedSeconds: 60, paused: false, history: [], future: [],
    }));
  }, { solution, givens });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const board = page.getByRole("grid", { name: "Sudoku board" });
  await expect(board.locator("button").nth(index)).toHaveText("");
  await board.locator("button").nth(index).click();
  await page.locator(".digits").getByRole("button", { name: String(solution[index]), exact: true }).click();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("sudoku:game:v3")!) as { values: number[]; elapsedSeconds: number });
  await expect.poll(async () => (await saved()).values).toEqual(solution);
  const elapsed = (await saved()).elapsedSeconds;
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(board.locator("button").nth(index)).toHaveText(String(solution[index]));
  // Cross two timer ticks: a completed board must not resume timing on reload.
  await page.waitForTimeout(2200);
  expect((await saved()).elapsedSeconds).toBe(elapsed);
});

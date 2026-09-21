import { expect, test, type Page } from "@playwright/test";

async function dragFive(page: Page, distance: number, pointerId: number) {
  const five = page.getByRole("button", { name: "5", exact: true });
  const startY = 740;
  await five.dispatchEvent("pointerdown", {
    clientX: 190,
    clientY: startY,
    pointerId,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await five.dispatchEvent("pointermove", {
    clientX: 191,
    clientY: startY - distance,
    pointerId,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  return five;
}

async function unlockPrivate(page: Page) {
  const five = await dragFive(page, 60, 7);

  await expect(page.locator(".private-reveal-layer")).toBeVisible();
  const draggedTop = await page.locator(".sudoku-reveal-screen").evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(draggedTop).toBeLessThan(-45);

  await five.dispatchEvent("pointermove", {
    clientX: 192,
    clientY: 620,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await five.dispatchEvent("pointerup", {
    clientX: 192,
    clientY: 620,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
  });
}

test("mobile Sudoku stays compact and unlock slides the whole screen over chat", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("grid", { name: "Sudoku board" })).toBeVisible();
  await expect(page.locator(".sudoku-logo")).toBeVisible();
  await expect(page.getByText(/Puzzle #\d{4}/)).toBeVisible();
  await expect(page.getByText("Time", { exact: true })).toBeVisible();
  await expect(page.getByText("Mistakes", { exact: true })).toBeVisible();
  await expect(page.getByText("Progress", { exact: true })).toBeVisible();

  const digitButtons = page.locator(".digits .digit");
  await expect(digitButtons).toHaveCount(9);
  const digitBoxes = await digitButtons.evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { top: Math.round(rect.top), left: rect.left, right: rect.right };
    }),
  );
  expect(new Set(digitBoxes.map((box) => box.top)).size).toBe(1);

  const boardBox = await page.getByRole("grid", { name: "Sudoku board" }).boundingBox();
  expect(boardBox).not.toBeNull();
  expect(Math.abs((digitBoxes.at(-1)?.right ?? 0) - (boardBox?.x ?? 0) - (boardBox?.width ?? 0))).toBeLessThanOrEqual(2);
  expect(Math.abs((digitBoxes[0]?.left ?? 0) - (boardBox?.x ?? 0))).toBeLessThanOrEqual(2);

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
  const editableCell = page.getByRole("gridcell").nth(2);
  await editableCell.click();
  for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    await page.getByRole("button", { name: digit, exact: true }).click();
    await expect(editableCell).toHaveText(digit);
    await expect(page.locator(".private-reveal-layer")).toHaveAttribute("inert", "");
  }

  await page.getByRole("button", { name: "Erase", exact: true }).click();
  await expect(editableCell).toHaveText("");

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(editableCell).toContainText("2");
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(editableCell).toHaveText("");

  const givenCell = page.getByRole("gridcell").nth(0);
  await givenCell.click();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(givenCell).toHaveText("5");

  // A short drag must reveal the private layer but snap the full Sudoku screen
  // back into place without opening it.
  const shortFive = await dragFive(page, 35, 6);
  await expect(page.locator(".private-reveal-layer")).toBeVisible();
  const shortTop = await page.locator(".sudoku-reveal-screen").evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(shortTop).toBeLessThan(-20);
  await shortFive.dispatchEvent("pointerup", {
    clientX: 191,
    clientY: 705,
    pointerId: 6,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
  });
  await expect(page.locator(".private-reveal-layer")).toHaveAttribute("inert", "", {
    timeout: 2_000,
  });
  const returnedTop = await page.locator(".sudoku-reveal-screen").evaluate(
    (element) => Math.round(element.getBoundingClientRect().top),
  );
  expect(returnedTop).toBe(0);

  await unlockPrivate(page);
  const email = page.getByLabel("Email");
  await expect(email).toBeVisible({ timeout: 30_000 });

  const privateOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(privateOverflow).toBeLessThanOrEqual(1);

  await expect(page.locator(".private-reveal-layer")).not.toHaveAttribute("inert", "", { timeout: 5_000 });
  await email.focus();
  await expect(email).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(page.getByRole("heading", { name: "Sudoku" })).toBeVisible();
  await expect(page.locator(".privacy-grid")).toBeVisible();
});

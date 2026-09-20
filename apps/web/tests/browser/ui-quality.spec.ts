import { expect, test, type Page } from "@playwright/test";

async function unlockPrivate(page: Page) {
  const five = page.getByRole("button", { name: "5", exact: true });
  await five.dispatchEvent("pointerdown", {
    clientX: 190,
    clientY: 740,
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

test("mobile Sudoku stays compact and unlock gesture is on digit five", async ({ page }) => {
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

  await unlockPrivate(page);
  const email = page.getByLabel("Email");
  await expect(email).toBeVisible({ timeout: 30_000 });

  const privateOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(privateOverflow).toBeLessThanOrEqual(1);

  await email.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(page.getByRole("heading", { name: "Sudoku" })).toBeVisible();
  await expect(page.locator(".privacy-grid")).toBeVisible();
});

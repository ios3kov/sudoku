import { expect, test, type Page } from "@playwright/test";

async function unlockPrivate(page: Page) {
  const five = page.getByRole("gridcell", { name: /, 5$/ }).first();
  await five.click();
  const board = page.getByRole("grid", { name: "Sudoku board" });
  await board.dispatchEvent("pointerdown", {
    clientX: 120,
    clientY: 220,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await board.dispatchEvent("pointerup", {
    clientX: 120,
    clientY: 100,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
  });
}

test("mobile shell has no horizontal overflow and keyboard-accessible auth", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("grid", { name: "Sudoku board" })).toBeVisible();
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

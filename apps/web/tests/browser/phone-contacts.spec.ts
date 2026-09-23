import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "browser acceptance password";
const testPhone = (index: number) => "+" + String(70000000000 + index);

async function reveal(page: Page) {
  await page.goto("/");
  const five = page.getByRole("button", { name: "5", exact: true });
  await expect(five).toBeVisible();
  const box = await five.boundingBox();
  if (!box) throw new Error("Missing Sudoku keypad");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await five.dispatchEvent("pointerdown", {
    clientX: x,
    clientY: y,
    pointerId: 91,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await five.dispatchEvent("pointermove", {
    clientX: x + 1,
    clientY: y * 0.45,
    pointerId: 91,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await expect(page.locator(".private-reveal-layer")).not.toHaveAttribute("inert", "");
}

async function login(page: Page, phone: string) {
  await reveal(page);
  await page.getByLabel("Phone number", { exact: true }).fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Use PIN for quick sign-in on this device?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(page.getByRole("button", { name: "New secure chat", exact: true })).toBeEnabled({ timeout: 120_000 });
}

test("system contact picker sync exposes only selected registered contacts", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(({ selectedPhone }) => {
    Object.defineProperty(navigator, "contacts", {
      configurable: true,
      value: {
        getProperties: async () => ["name", "tel"],
        select: async () => [{ name: ["PIN Member"], tel: [selectedPhone] }],
      },
    });
  }, { selectedPhone: testPhone(3) });

  await login(page, testPhone(5));
  await page.getByRole("button", { name: "New secure chat", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create secure chat" })).toBeVisible();

  const directory = page.locator(".directory-item");
  await expect(directory).toHaveCount(0);

  await page.getByRole("button", { name: "Choose phone contacts", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 registered contact");
  await expect(directory.filter({ hasText: testPhone(3) })).toBeVisible();
});


test("native iOS contact bridge syncs only explicitly selected phones", async ({ page }) => {
  test.setTimeout(180_000);

  await login(page, testPhone(5));

  await page.evaluate(({ selectedPhone }) => {
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: {
        Plugins: {
          SudokuNative: {
            selectContacts: async () => ({
              contacts: [{ name: ["PIN Member"], tel: [selectedPhone] }],
            }),
          },
        },
      },
    });
    window.dispatchEvent(new Event("sudoku:native-contacts-ready"));
  }, { selectedPhone: testPhone(2) });

  await page.getByRole("button", { name: "New secure chat", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create secure chat" })).toBeVisible();

  await page.getByRole("button", { name: "Choose phone contacts", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("registered contact");
  await expect(page.locator(".directory-item").filter({ hasText: testPhone(2) })).toBeVisible();
});

test("manual phone fallback syncs a contact when picker is unavailable", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, testPhone(4));
  await page.getByRole("button", { name: "New secure chat", exact: true }).click();

  await expect(page.getByRole("button", { name: "Choose phone contacts", exact: true })).toHaveCount(0);
  await page.getByLabel("Add contact by phone", { exact: true }).fill(testPhone(2));
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("registered contact");
  await expect(page.locator(".directory-item").filter({ hasText: testPhone(2) })).toBeVisible();
});


test("Contacts panel lists and removes an allowed contact", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, testPhone(3));

  await page.getByRole("button", { name: "Contacts", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Phone contacts", exact: true });
  await expect(panel).toBeVisible();

  await panel.getByLabel("Add contact by phone", { exact: true }).fill(testPhone(5));
  await panel.getByRole("button", { name: "Add contact", exact: true }).click();
  await expect(panel.getByText(testPhone(5), { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(panel.getByText(testPhone(5), { exact: true })).toHaveCount(0);

  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toHaveCount(0);
});

import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "browser acceptance password";
const testPhone = (index: number) => "+" + String(70000000000 + index);

async function revealCurrentPage(page: Page) {
  const five = page.getByRole("button", { name: "5", exact: true });
  await expect(five).toBeVisible();
  const box = await five.boundingBox();
  if (!box) throw new Error("Missing Sudoku keypad");
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await five.dispatchEvent("pointerdown", { clientX: x, clientY: y, pointerId: 1, pointerType: "touch", isPrimary: true, buttons: 1 });
  await five.dispatchEvent("pointermove", { clientX: x + 1, clientY: y * .45, pointerId: 1, pointerType: "touch", isPrimary: true, buttons: 1 });
  await expect(page.locator(".private-reveal-layer")).not.toHaveAttribute("inert", "");
}

async function reveal(page: Page) {
  await page.goto("/");
  await revealCurrentPage(page);
}

async function passwordLogin(page: Page, phone: string) {
  await reveal(page);
  await page.getByLabel("Phone number", { exact: true }).fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Remember phone on this device").check();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Use PIN for quick sign-in on this device?", { exact: true })).toBeVisible();
  await expect(page.getByText("Messages", { exact: true })).toHaveCount(0);
}

for (const role of ["member", "admin"]) {
  test(`first password login offers device PIN and reload unlock recovers E2EE for ${role}`, async ({ page, context }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = testPhone(role === "admin" ? 4 : 3);

    await passwordLogin(page, phone);
    await page.getByRole("button", { name: "Set PIN", exact: true }).click();
    await page.getByLabel("Four-digit PIN", { exact: true }).fill("0123");
    await page.getByLabel("Confirm PIN", { exact: true }).fill("0123");
    await page.getByRole("button", { name: "Save PIN", exact: true }).click();

    await expect(page.getByText("Messages", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite", exact: true })).toHaveCount(role === "admin" ? 1 : 0);

    const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(JSON.stringify(storage)).not.toContain(PASSWORD);
    expect(JSON.stringify(storage)).not.toContain('"0123"');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // A navigation/reload must lock the private area without poisoning the
    // persisted OpenMLS state. PIN unlock must then fully bootstrap E2EE.
    await page.reload();
    await revealCurrentPage(page);
    await expect(page.getByLabel("Device PIN", { exact: true })).toBeVisible();
    await expect(page.getByText("Messages", { exact: true })).toHaveCount(0);
    await expect(page.locator(".messenger-reveal-preview")).toHaveCount(0);
    expect((await context.request.get("/v1/conversations")).status()).toBe(423);

    await page.getByLabel("Device PIN", { exact: true }).fill("9876");
    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.getByRole("main", { name: "Private area locked", exact: true }).getByRole("alert"))
      .toContainText("Incorrect PIN");

    if (role === "member") {
      for (let i = 0; i < 4; i++) {
        await page.getByLabel("Device PIN", { exact: true }).fill("9876");
        const reply = page.waitForResponse((r) => r.url().endsWith("/device-access/unlock"));
        await page.getByRole("button", { name: "Unlock", exact: true }).click();
        await reply;
        await expect(page.getByRole("button", { name: "Unlock", exact: true })).toBeEnabled();
      }
      await expect(page.getByLabel("Account password", { exact: true })).toBeVisible();
      await reveal(page);
      await expect(page.getByLabel("Account password", { exact: true })).toBeVisible();
      await page.getByLabel("Account password", { exact: true }).fill(PASSWORD);
    } else {
      await page.getByLabel("Device PIN", { exact: true }).fill("0123");
    }

    await page.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(page.getByText("Messages", { exact: true })).toBeVisible();
    await expect(page.getByText("Secure messaging needs a restart.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New secure chat", exact: true })).toBeEnabled({ timeout: 120_000 });

    // Settings remain a secondary management surface after onboarding.
    await page.getByRole("button", { name: "Devices", exact: true }).click();
    const panel = page.getByRole("region", { name: "Login and device PIN" });
    await expect(panel.getByText("Device PIN is enabled.")).toBeVisible();

    expect((await context.request.post("/v1/auth/logout", { headers: { origin: "http://127.0.0.1:3000" } })).status()).toBe(204);
    await reveal(page);
    await expect(page.getByLabel("Phone number", { exact: true })).toHaveValue(phone);
    await page.getByLabel("Remember phone on this device").uncheck();
    await reveal(page);
    await expect(page.getByLabel("Phone number", { exact: true })).toHaveValue("");
  });
}

test("Not now enters the app without enabling a device PIN", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await passwordLogin(page, testPhone(5));
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(page.getByText("Messages", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Device PIN", { exact: true })).toHaveCount(0);

  const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(JSON.stringify(storage)).not.toContain(PASSWORD);

  await page.reload();
  await revealCurrentPage(page);
  await expect(page.getByText("Messages", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Device PIN", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Use PIN for quick sign-in on this device?", { exact: true })).toHaveCount(0);
});

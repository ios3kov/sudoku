import { expect, test, type Page } from "@playwright/test";
import { ensureSudokuGame } from "./support/sudoku-start";

const PASSWORD = "browser acceptance password";
const testPhone = (index: number) => "+" + String(70000000000 + index);

async function revealCurrentPage(page: Page) {
  await ensureSudokuGame(page);
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

async function enterPin(page: Page, pin: string) {
  const reply = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/auth/device-access/unlock")
      && response.request().method() === "POST",
  );
  await page.getByLabel("Device PIN", { exact: true }).fill(pin);
  return reply;
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
    // A valid password response still awaiting onboarding has not entered the
    // messenger. It must not switch future game launches to quick play yet.
    expect(await page.evaluate(() => localStorage.getItem("sudoku.startup.v1"))).toBeNull();
    await page.getByRole("button", { name: "Set PIN", exact: true }).click();
    await page.getByLabel("Four-digit PIN", { exact: true }).fill("0123");
    await page.getByLabel("Confirm PIN", { exact: true }).fill("0123");
    await page.getByRole("button", { name: "Save PIN", exact: true }).click();

    await expect(page.getByText("Messages", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("sudoku.startup.v1"))).toBe("quick-play");
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

    const firstWrong = await enterPin(page, "9876");
    expect((await firstWrong).status()).toBe(403);
    await expect(page.getByRole("main", { name: "Private area locked", exact: true }).getByRole("alert"))
      .toContainText("Incorrect PIN");
    await expect(page.getByLabel("Device PIN", { exact: true })).toHaveValue("");

    if (role === "member") {
      for (let i = 0; i < 4; i++) {
        const reply = await enterPin(page, "9876");
        await reply;
      }
      await expect(page.getByLabel("Account password", { exact: true })).toBeVisible();
      await reveal(page);
      await expect(page.getByLabel("Account password", { exact: true })).toBeVisible();
      await page.getByLabel("Account password", { exact: true }).fill(PASSWORD);
    } else {
      await page.getByRole("button", { name: "Use account password", exact: true }).click();
      await expect(page.getByLabel("Account password", { exact: true })).toBeVisible();
      await page.reload();
      await revealCurrentPage(page);
      const correct = await enterPin(page, "0123");
      expect((await correct).status()).toBe(200);
    }

    if (role === "member") {
      await page.getByRole("button", { name: "Unlock", exact: true }).click();
    }
    await expect(page.getByText("Messages", { exact: true })).toBeVisible();
    await expect(page.getByText("Secure messaging needs a restart.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New secure chat", exact: true })).toBeEnabled({ timeout: 120_000 });

    if (role === "member") {
      await page.evaluate(() => {
        Object.defineProperty(Notification, "requestPermission", {
          configurable: true,
          value: async () => "denied",
        });
      });
      await page.getByRole("button", { name: "Enable notifications", exact: true }).click();
      await expect(page.getByRole("button", { name: "Retry notifications", exact: true })).toBeVisible();
    }

    if (role === "admin") {
      await page.getByRole("button", { name: "Invite", exact: true }).click();
      const invite = page.getByRole("dialog", { name: "Create invite", exact: true });
      await expect(invite).toBeVisible();
      await invite.getByRole("button", { name: "Close", exact: true }).click();
      await expect(invite).toHaveCount(0);
    }

    // Settings remain a secondary management surface after onboarding.
    await page.getByRole("button", { name: "Devices", exact: true }).click();
    const panel = page.getByRole("region", { name: "Login and device PIN" });
    await expect(panel.getByText("Device PIN is enabled.")).toBeVisible();
    const devices = page.getByRole("dialog", { name: "Devices and sessions", exact: true });
    await devices.getByRole("button", { name: "Close", exact: true }).click();
    await expect(devices).toHaveCount(0);

    const signedOut = page.waitForResponse(response =>
      response.url().endsWith("/v1/auth/logout") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    expect((await signedOut).ok()).toBe(true);
    // Logout also clears local encrypted state before concealing the surface.
    // Navigating immediately after click can abort the request and retain PIN.
    await expect(page.locator(".private-reveal-layer")).toHaveAttribute("inert", "");
    await reveal(page);
    await expect(page.getByLabel("Phone number", { exact: true })).toHaveValue(phone);
    await page.getByLabel("Remember phone on this device").uncheck();
    await reveal(page);
    await expect(page.getByLabel("Phone number", { exact: true })).toHaveValue("");
  });
}

test("correct PIN auto-submits once and unlocks on the first attempt after repeated relaunches", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await passwordLogin(page, testPhone(2));
  await page.getByRole("button", { name: "Set PIN", exact: true }).click();
  await page.getByLabel("Four-digit PIN", { exact: true }).fill("2468");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("2468");
  await page.getByRole("button", { name: "Save PIN", exact: true }).click();
  await expect(page.getByText("Messages", { exact: true })).toBeVisible();

  let unlockRequests = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/v1/auth/device-access/unlock")
      && request.method() === "POST"
    ) unlockRequests += 1;
  });

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.reload();
    await revealCurrentPage(page);
    await expect(page.getByLabel("Device PIN", { exact: true })).toBeVisible();
    const reply = await enterPin(page, "2468");
    expect((await reply).status()).toBe(200);
    await expect(page.getByText("Messages", { exact: true })).toBeVisible();
    expect(unlockRequests).toBe(attempt);
  }
});

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

test("login navigation, invite submit and hide controls work", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await reveal(page);

  await page.getByRole("button", { name: "Use an invite", exact: true }).click();
  await expect(page.getByRole("button", { name: "Join", exact: true })).toBeVisible();
  await page.getByLabel("Invite code").fill("invalid-audit-invite");
  await page.getByLabel("Name").fill("Button Audit");
  await page.getByLabel("Phone number", { exact: true }).fill("+70000000008");
  await page.getByLabel("Password", { exact: true }).fill("button audit password");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.locator(".form-error[role=alert]")).toBeVisible();

  await page.getByRole("button", { name: "I already have an account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(page.locator(".private-reveal-layer")).toHaveAttribute("inert", "");
});

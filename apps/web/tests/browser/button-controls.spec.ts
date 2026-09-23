import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type {} from "./support/button-controls-fixture";

const webRoot = path.resolve(__dirname, "../..");
const importFixture = new Function("url", "return import(url)") as (
  url: string,
) => Promise<{ default: (entry: string) => Promise<string> }>;

let bundle: string;
let styles: string;

test.use({ actionTimeout: 5_000 });

test.beforeAll(async () => {
  const { default: build } = await importFixture(
    pathToFileURL(
      path.join(webRoot, "tests/browser/support/build-ux-fixture.mjs"),
    ).href,
  );
  bundle = await build("button-controls-fixture.tsx");
  styles = (
    await Promise.all(
      [
        "app/globals.css",
        "features/messenger/messenger-redesign.css",
        "features/messenger/messenger-ux3.css",
        "features/messenger/device-access.css",
      ].map((file) => readFile(path.join(webRoot, file), "utf8")),
    )
  ).join("\n");
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
});

async function mount(page: Page, mode: Parameters<Window["__buttonAudit"]["mount"]>[0]) {
  await page.evaluate((value) => window.__buttonAudit.mount(value), mode);
}

test("admin invite create, copy and close buttons perform their actions", async ({ page }) => {
  await mount(page, "invite");
  const phone = await page.evaluate(() => window.__buttonAudit.syntheticPhone(8));
  await page.getByLabel("Phone number", { exact: true }).fill(phone);
  await page.getByRole("button", { name: "Create invite", exact: true }).click();
  await expect(page.getByText("invite-token", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__buttonAudit.calls.invites.at(-1))).toBe(phone);
  expect(await page.evaluate(() => window.__buttonAudit.calls.clipboard.at(-1))).toBe("invite-token");

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("invite closed", { exact: true })).toBeVisible();
});

test("conversation pin, mute and done controls update the real component state", async ({ page }) => {
  await mount(page, "preferences");

  await page.getByRole("button", { name: /Pin chat/ }).click();
  await expect(page.getByRole("button", { name: /Unpin chat/ })).toBeVisible();

  await page.getByRole("button", { name: /Mute notifications/ }).click();
  await expect(page.getByRole("button", { name: /Unmute notifications/ })).toBeVisible();

  const preferences = await page.evaluate(() => window.__buttonAudit.calls.preferences);
  expect(preferences).toEqual([{ is_pinned: true }, { notifications_muted: true }]);

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("preferences closed", { exact: true })).toBeVisible();
});

test("Devices phone, PIN, revoke, sign-out and close controls all perform actions", async ({ page }) => {
  await mount(page, "sessions");
  const dialog = page.getByRole("dialog", { name: "Devices and sessions", exact: true });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(dialog.getByText("Other Device", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__buttonAudit.calls.revokedSessions)).toContain("other-session");

  const panel = page.getByRole("region", { name: "Login and device PIN" });
  const nextPhone = await page.evaluate(() => window.__buttonAudit.syntheticPhone(9));
  await panel.getByLabel("Phone number", { exact: true }).fill(nextPhone);
  await panel.getByLabel("Account password for phone change", { exact: true }).fill("test password");
  await panel.getByRole("button", { name: "Change phone", exact: true }).click();
  await expect(page.getByText("phone updated " + nextPhone, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__buttonAudit.calls.phoneUpdates.at(-1))).toBe(nextPhone);

  await panel.getByLabel("Account password", { exact: true }).fill("test password");
  await panel.getByLabel("New four-digit PIN", { exact: true }).fill("2468");
  await panel.getByLabel("Confirm PIN", { exact: true }).fill("2468");
  await panel.getByRole("button", { name: "Change PIN", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Device PIN saved");

  await panel.getByLabel("Account password", { exact: true }).fill("test password");
  await panel.getByRole("button", { name: "Remove PIN", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Device PIN removed");

  const puts = await page.evaluate(() =>
    window.__buttonAudit.calls.fetches.filter(
      (item) => item.path === "/v1/auth/device-access" && item.method === "PUT",
    ),
  );
  expect(puts).toHaveLength(2);
  expect((puts[0].body as { pin?: string }).pin).toBe("2468");
  expect((puts[1].body as { pin?: string | null }).pin).toBeNull();

  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("current revoked", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("sessions closed", { exact: true })).toBeVisible();
});

test("message search find, result and done controls work", async ({ page }) => {
  await mount(page, "search");

  await page.getByPlaceholder("Search messages").fill("needle");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const result = page.getByRole("button", { name: /needle result/ });
  await expect(result).toBeVisible();
  expect(await page.evaluate(() => window.__buttonAudit.calls.searches.at(-1))).toBe("needle");

  await result.click();
  await expect(page.getByText("selected message-1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("search closed", { exact: true })).toBeVisible();
});

test("security copy, verification and close controls work", async ({ page }) => {
  await mount(page, "security");
  await expect(page.getByText("1111 2222 3333 4444", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => window.__buttonAudit.calls.clipboard.at(-1))).toBe(
    "1111 2222 3333 4444",
  );

  await page.getByRole("button", { name: "Mark verified", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verified", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__buttonAudit.calls.verified.at(-1))).toBe(
    "peer-device-1234",
  );

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("security closed", { exact: true })).toBeVisible();
});

test("group rename, role, add, remove, leave and close controls work", async ({ page }) => {
  await mount(page, "group");

  await page.getByLabel("Group name", { exact: true }).fill("Renamed Group");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() =>
    page.evaluate(() => window.__buttonAudit.calls.group.includes("rename:Renamed Group")),
  ).toBe(true);

  await page.getByRole("button", { name: "Make owner", exact: true }).click();
  await expect(page.getByRole("button", { name: "Make member", exact: true })).toBeVisible();

  const candidate = page.getByRole("button", { name: /Candidate User/ });
  await expect(candidate).toBeVisible();
  await candidate.click();
  await expect.poll(() =>
    page.evaluate(() => window.__buttonAudit.calls.group.includes("add:candidate")),
  ).toBe(true);

  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(() =>
    page.evaluate(() => window.__buttonAudit.calls.group.includes("remove:candidate")),
  ).toBe(true);

  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByText("left group", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("group closed", { exact: true })).toBeVisible();
});

test("new-chat Direct, Group, selection, create and close controls work", async ({ page }) => {
  await mount(page, "new-chat");

  await expect(page.getByRole("button", { name: "Direct", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const candidate = page.getByRole("button", { name: /Candidate User/ });
  await expect(candidate).toBeVisible();
  await candidate.click();
  await expect(page.getByText("created new-direct", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__buttonAudit.calls.created)).toContain(
    "direct:candidate",
  );

  await page.getByRole("button", { name: "Group", exact: true }).click();
  await expect(page.getByRole("button", { name: "Group", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByPlaceholder("Group name").fill("Button Audit Group");
  await candidate.click();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.getByText("created new-group", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("new chat closed", { exact: true })).toBeVisible();
});

test("Contacts add, remove and close controls update the allow-list", async ({ page }) => {
  await mount(page, "contacts");
  const dialog = page.getByRole("dialog", { name: "Phone contacts", exact: true });
  const candidatePhone = await page.evaluate(() => window.__buttonAudit.syntheticPhone(3));
  await expect(dialog.getByText(candidatePhone, { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog.getByText(candidatePhone, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__buttonAudit.calls.removedContacts)).toEqual([
    "candidate",
  ]);

  const manualPhone = await page.evaluate(() => window.__buttonAudit.syntheticPhone(7));
  await dialog.getByLabel("Add contact by phone", { exact: true }).fill(manualPhone);
  await dialog.getByRole("button", { name: "Add contact", exact: true }).click();
  await expect(dialog.getByText(candidatePhone, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__buttonAudit.calls.contactSyncs.at(-1))).toEqual([
    manualPhone,
  ]);

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("contacts closed", { exact: true })).toBeVisible();
});

test("PIN-protected attachment Open control resolves a safe blob link", async ({ page }) => {
  await mount(page, "protected");

  await page.getByRole("button", { name: /Open legacy\.txt/ }).click();
  await expect(page.getByRole("link", { name: /legacy\.txt/ })).toBeVisible();

  const paths = await page.evaluate(() =>
    window.__buttonAudit.calls.fetches.map((item) => item.path),
  );
  expect(paths).toContain(
    "/v1/assets/00000000-0000-4000-8000-000000000001/download-url",
  );
  expect(paths).toContain("https://assets.example.test/signed");
});

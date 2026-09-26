import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type {} from "./support/button-controls-fixture";

const webRoot = path.resolve(__dirname, "../..");
const importFixture = new Function("url", "return import(url)") as (url: string) => Promise<{ default: (entry: string) => Promise<string> }>;
let bundle: string;
let styles: string;

test.use({ actionTimeout: 5_000 });

test.beforeAll(async () => {
  const { default: build } = await importFixture(
    pathToFileURL(path.join(webRoot, "tests/browser/support/build-ux-fixture.mjs")).href,
  );
  bundle = await build("button-controls-fixture.tsx");
  styles = (await Promise.all([
    "app/globals.css",
    "features/messenger/messenger-redesign.css",
    "features/messenger/messenger-ux3.css",
    "features/messenger/device-access.css",
  ].map((file) => readFile(path.join(webRoot, file), "utf8")))).join("\n");
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
});

async function mount(page: import("@playwright/test").Page, mode: string) {
  await page.evaluate((value) => window.__buttonAudit.mount(value as never), mode);
}

test("admin invite create, copy and close buttons perform their actions", async ({ page }) => {
  await mount(page, "invite");
  await page.getByLabel("Phone number", { exact: true }).fill("+70000000003");
  await page.getByRole("button", { name: "Create invite", exact: true }).click();
  await expect(page.getByText("invite-token", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__buttonAudit.calls.invites.at(-1))).toBe("+70000000003");
  expect(await page.evaluate(() => window.__buttonAudit.calls.clipboard.at(-1))).toBe("invite-token");

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("invite closed", { exact: true })).toBeVisible();
});

test("conversation settings pin, mute and done buttons update state", async ({ page }) => {
  await mount(page, "preferences");

  await page.getByRole("button", { name: /Pin chat/ }).click();
  await expect(page.getByRole("button", { name: /Unpin chat/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__buttonAudit.calls.preferences.length)).toBe(1);

  await page.getByRole("button", { name: /Mute notifications/ }).click();
  await expect(page.getByRole("button", { name: /Unmute notifications/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__buttonAudit.calls.preferences.length)).toBe(2);

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("preferences closed", { exact: true })).toBeVisible();
});

test("devices controls revoke sessions, manage PIN and close", async ({ page }) => {
  await mount(page, "sessions");
  await expect(page.getByRole("dialog", { name: "Devices and sessions" })).toBeVisible();
  await expect(page.getByText("PIN is enabled on this device.", { exact: true })).toBeVisible();

  const access = page.getByRole("region", { name: "Login and device PIN" });
  await access.getByLabel("Phone number", { exact: true }).fill("+70000000009");
  await access.getByLabel("Account password for phone change", { exact: true }).fill("test password");
  await access.getByRole("button", { name: "Change phone", exact: true }).click();
  await expect(access.getByRole("status")).toContainText("Phone number updated");
  expect(await page.evaluate(() => window.__buttonAudit.calls.phoneUpdates.at(-1))).toBe("+70000000009");

  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByText("Other Device", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__buttonAudit.calls.revokedSessions)).toContain("other-session");

  const panel = access;
  await panel.getByLabel("Account password", { exact: true }).fill("test password");
  await panel.getByLabel("New four-digit PIN").fill("2468");
  await panel.getByLabel("Confirm PIN", { exact: true }).fill("2468");
  await panel.getByRole("button", { name: "Change PIN", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Device PIN saved");

  await panel.getByLabel("Account password", { exact: true }).fill("test password");
  await panel.getByRole("button", { name: "Remove PIN", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Device PIN removed");
  const puts = await page.evaluate(() => window.__buttonAudit.calls.fetches.filter((item) =>
    item.path === "/v1/auth/device-access" && item.method === "PUT"));
  expect(puts).toHaveLength(2);
  expect((puts[0].body as { pin?: string }).pin).toBe("2468");
  expect((puts[1].body as { pin?: string | null }).pin).toBeNull();

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("current revoked", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("sessions closed", { exact: true })).toBeVisible();
});

test("message search find, result and done buttons work", async ({ page }) => {
  await mount(page, "search");
  const query = page.getByPlaceholder("Search messages");
  await query.fill("needle");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByRole("button", { name: /needle result/ })).toBeVisible();
  expect(await page.evaluate(() => window.__buttonAudit.calls.searches.at(-1))).toBe("needle");

  await page.getByRole("button", { name: /needle result/ }).click();
  await expect(page.getByText("selected message-1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("search closed", { exact: true })).toBeVisible();
});

test("security verify copy, mark verified and close buttons work", async ({ page }) => {
  await mount(page, "security");
  await expect(page.getByText("1111 2222 3333 4444", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => window.__buttonAudit.calls.clipboard.at(-1))).toBe("1111 2222 3333 4444");

  await page.getByRole("button", { name: "Mark verified", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verified", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__buttonAudit.calls.verified.at(-1))).toBe("peer-device-1234");

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("security closed", { exact: true })).toBeVisible();
});

test("group rename, role, add, remove, leave and close buttons work", async ({ page }) => {
  await mount(page, "group");

  const name = page.getByLabel("Group name");
  await name.fill("Renamed Group");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__buttonAudit.calls.group.includes("rename:Renamed Group"))).toBe(true);

  await page.getByRole("button", { name: "Make owner", exact: true }).click();
  await expect(page.getByRole("button", { name: "Make member", exact: true })).toBeVisible();

  await page.getByLabel("Add people").fill("ca");
  const candidateButton = page.getByRole("button", { name: /Candidate User/ });
  await expect(candidateButton).toBeVisible();
  await candidateButton.click();
  await expect.poll(() => page.evaluate(() => window.__buttonAudit.calls.group.includes("add:candidate"))).toBe(true);

  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__buttonAudit.calls.group.includes("remove:candidate"))).toBe(true);

  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByText("left group", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__buttonAudit.calls.group.includes("remove:me"))).toBe(true);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("group closed", { exact: true })).toBeVisible();
});

test("new chat direct, group, selection, create and close buttons work", async ({ page }) => {
  await mount(page, "new-chat");
  await expect(page.getByRole("button", { name: "Direct", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Search people").fill("ca");
  const candidate = page.getByRole("button", { name: /Candidate User/ });
  await expect(candidate).toBeVisible();
  await candidate.click();
  await expect(page.getByText("created new-direct", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__buttonAudit.calls.created)).toContain("direct:candidate");

  await page.getByRole("button", { name: "Group", exact: true }).click();
  await expect(page.getByRole("button", { name: "Group", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByPlaceholder("Group name").fill("Button Audit Group");
  await candidate.click();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.getByText("created new-group", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__buttonAudit.calls.created)).toContain("group:Button Audit Group:candidate");

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("new chat closed", { exact: true })).toBeVisible();
});


test("contacts add, remove and close buttons update the contact allowlist", async ({ page }) => {
  await mount(page, "contacts");
  const panel = page.getByRole("dialog", { name: "Phone contacts", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("+70000000003", { exact: true })).toBeVisible();

  await panel.getByLabel("Add contact by phone", { exact: true }).fill("+70000000004");
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("1 registered contact");
  expect(await page.evaluate(() => window.__buttonAudit.calls.syncedPhones.at(-1))).toEqual(["+70000000004"]);

  await panel.getByRole("button", { name: /Remove Candidate User/ }).click();
  expect(await page.evaluate(() => window.__buttonAudit.calls.removedContacts.at(-1))).toBe("candidate");

  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("contacts closed", { exact: true })).toBeVisible();
});

test("PIN-protected attachment open button resolves a safe blob link", async ({ page }) => {
  await mount(page, "protected");
  await page.getByRole("button", { name: /Open legacy\.txt/ }).click();
  await expect(page.getByRole("link", { name: /legacy\.txt/ })).toBeVisible();
  const paths = await page.evaluate(() => window.__buttonAudit.calls.fetches.map((item) => item.path));
  expect(paths).toContain("/v1/assets/00000000-0000-4000-8000-000000000001/download-url");
  expect(paths).toContain("https://assets.example.test/signed");
});

import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type {} from "./support/hardening-fixture";

const directory = path.resolve(__dirname, "support");
const importCompiler = new Function("url", "return import(url)") as (url: string) => Promise<{
  default: (options: { entry: string; aliases: Record<string, string> }) => Promise<string>;
}>;
let bundle: string;
test.beforeAll(async () => {
  const compiler = await importCompiler(pathToFileURL(path.join(directory, "build-ux-fixture.mjs")).href);
  bundle = await compiler.default({
    entry: "hardening-fixture.tsx",
    aliases: { "./uploads$": path.join(directory, "hardening-uploads.ts") },
  });
});
test.beforeEach(async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
});
async function start(page: Page) {
  await page.evaluate(() => window.__hardening.mount());
  await expect(page.locator("textarea")).toBeEnabled();
  await page.getByRole("button", { name: "Mic", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__hardening.controls.permissions.length)).toBe(1);
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("recorder constructor and start failure stop all acquired tracks", async ({ page }) => {
  await page.evaluate(() => { window.__hardening.controls.failConstructor = true; });
  await start(page);
  await page.evaluate(() => window.__hardening.controls.grant());
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await page.evaluate(() => window.__hardening.controls.tracks.every((t) => t.stopped))).toBe(true);
  await page.evaluate(() => {
    window.__hardening.controls.failConstructor = false;
    window.__hardening.controls.failStart = true;
  });
  await page.getByRole("button", { name: "Mic", exact: true }).click();
  await page.evaluate(() => window.__hardening.controls.grant(1));
  await settle(page);
  expect(await page.evaluate(() => window.__hardening.controls.tracks.every((t) => t.stopped))).toBe(true);
  expect(await page.evaluate(() => window.__hardening.controls.uploads.length)).toBe(0);
});

test("permission granted after Hide cannot start recording", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(page.locator("textarea")).toHaveCount(0);
  await page.evaluate(() => window.__hardening.controls.grant());
  await settle(page);
  expect(await page.evaluate(() => window.__hardening.controls.tracks.every((t) => t.stopped))).toBe(true);
  expect(await page.evaluate(() => window.__hardening.controls.recorders.length)).toBe(0);
});

test("double tap while permission is pending creates only one request", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Mic", exact: true }).dispatchEvent("click");
  await settle(page);
  expect(await page.evaluate(() => window.__hardening.controls.permissions.length)).toBe(1);
});

test("recorder error never uploads its queued final data", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__hardening.controls.grant());
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await page.evaluate(() => window.__hardening.controls.recorders[0].fail());
  await settle(page);
  expect(await page.evaluate(() => window.__hardening.controls.uploads.length)).toBe(0);
  expect(await page.evaluate(() => window.__hardening.controls.tracks.every((t) => t.stopped))).toBe(true);
});

test("ordinary Stop uploads once, releases microphone and sends encrypted metadata", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__hardening.controls.grant());
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__hardening.controls.uploads.length)).toBe(1);
  expect(await page.evaluate(() => window.__hardening.controls.tracks.every((t) => t.stopped))).toBe(true);
  await page.evaluate(() => {
    const c = window.__hardening.controls;
    c.uploads[0].resolve({ asset: { id: c.metadata.assetId, e2ee_ciphertext: true }, metadata: c.metadata });
  });
  await expect.poll(() => page.evaluate(() => window.__hardening.controls.sends.length)).toBe(1);
  expect(await page.evaluate(() => window.__hardening.controls.sends[0])).toMatchObject({ messageType: "voice", body: null, assetIds: ["asset-one"] });
});

test("finishing an upload after Hide does not publish a voice message", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__hardening.controls.grant());
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__hardening.controls.uploads.length)).toBe(1);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await page.evaluate(() => {
    const c = window.__hardening.controls;
    c.uploads[0].resolve({ asset: { id: c.metadata.assetId }, metadata: c.metadata });
  });
  await settle(page);
  expect(await page.evaluate(() => window.__hardening.controls.sends.length)).toBe(0);
});

test("decryption finishing after unmount cannot create a private object URL", async ({ page }) => {
  await page.evaluate(() => window.__hardening.mount("image"));
  await expect.poll(() => page.evaluate(() => window.__hardening.controls.decryptions.length)).toBe(1);
  await page.evaluate(() => window.__hardening.hide());
  await expect(page.locator("button")).toHaveCount(0);
  await page.evaluate(() => window.__hardening.controls.decryptions[0].resolve(new File(["private"], "private.txt")));
  await settle(page);
  expect(await page.evaluate(() => window.__hardening.controls.createdUrls.length)).toBe(0);
});

test("offscreen decryption is invalidated and returning image can load again", async ({ page }) => {
  await page.evaluate(() => window.__hardening.mount("image"));
  await expect.poll(() => page.evaluate(() => window.__hardening.controls.decryptions.length)).toBe(1);
  await page.evaluate(() => window.__hardening.controls.intersection(false));
  await expect(page.getByText("Load encrypted image", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__hardening.controls.decryptions[0].resolve(new File(["private"], "old.txt")));
  await settle(page);
  expect(await page.evaluate(() => window.__hardening.controls.createdUrls.length)).toBe(0);
  await page.evaluate(() => window.__hardening.controls.intersection(true));
  await expect.poll(() => page.evaluate(() => window.__hardening.controls.decryptions.length)).toBe(2);
  await page.evaluate(() => window.__hardening.controls.decryptions[1].resolve(new File(["new"], "new.txt")));
  await expect.poll(() => page.evaluate(() => window.__hardening.controls.createdUrls.length)).toBe(1);
  await page.evaluate(() => window.__hardening.hide());
  await expect.poll(() => page.evaluate(() => window.__hardening.controls.revokedUrls.length)).toBe(1);
});

test("voice decryption failure is handled instead of an unhandled rejection", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => window.__hardening.mount("audio"));
  await page.getByRole("button", { name: "Load encrypted voice", exact: true }).click();
  await page.evaluate(() => window.__hardening.controls.decryptions[0].reject(new Error("download unavailable")));
  await expect(page.getByText("Encrypted attachment unavailable", { exact: true })).toBeVisible();
  await settle(page);
  expect(errors).toEqual([]);
});

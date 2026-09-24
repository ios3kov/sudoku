import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type {} from "./support/audit-fixture";

const webRoot = path.resolve(__dirname, "../..");
const importFixture = new Function("url", "return import(url)") as (url: string) => Promise<{default: (entry: string) => Promise<string>}>;
let bundle: string, styles: string;
test.beforeAll(async () => {
  const {default: build} = await importFixture(pathToFileURL(path.join(webRoot, "tests/browser/support/build-ux-fixture.mjs")).href);
  bundle = await build("audit-fixture.tsx");
  styles = (await Promise.all(["app/globals.css", "features/messenger/messenger-redesign.css", "features/messenger/messenger-ux3.css"].map(file => readFile(path.join(webRoot, file), "utf8")))).join("\n");
});
test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.setContent('<html lang="en"><body><div id="root"></div></body></html>');
  await page.addStyleTag({content: styles});
  await page.addScriptTag({content: bundle});
  await page.evaluate(() => {
    window.__predeployAudit.seedHistory();
    window.__predeployAudit.mount("chat");
  });
  await expect(page.getByRole("textbox", {name: "Message", exact: true})).toBeEnabled();
});

for (const scale of [200, 300]) {
  test(`conversation reflows at ${scale}% text size on a narrow screen`, async ({page}) => {
    await page.setViewportSize({width: 320, height: 812});
    await page.getByRole("textbox", {name: "Message", exact: true}).fill("Large text draft remains editable and can be sent");
    await page.evaluate((percent) => {
      document.documentElement.style.setProperty("--sudoku-text-size", `${percent}%`);
      window.dispatchEvent(new Event("sudoku:text-size-changed"));
    }, scale);
    await expect(page.locator('[data-message-id="seed-19"] .message-bubble p')).toHaveCSS("font-size", `${16 * scale / 100}px`);
    for (const name of ["Back to conversations", "Hide", "Attach encrypted file", "Record voice message", "Send"]) {
      const control = page.getByRole("button", {name, exact: true});
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    const history = page.getByRole("region", {name: "Message history"});
    expect(await history.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.getByRole("button", {name: "Send", exact: true}).click();
    await expect.poll(() => page.evaluate(() => window.__predeployAudit.protocol.sends)).toBe(1);
  });
}

test("history supports keyboard scrolling and read details are accessible text", async ({page}) => {
  const history = page.getByRole("region", {name: "Message history"});
  await history.focus();
  await expect(history).toBeFocused();
  const before = await history.evaluate(node => node.scrollTop);
  await page.keyboard.press("PageUp");
  await expect.poll(() => history.evaluate(node => node.scrollTop)).toBeLessThan(before);
  const receipt = page.locator('[data-message-id="seed-19"] .message-delivery');
  await expect(receipt).toMatchAriaSnapshot('- text: /Read by Alice/');
});

test("message actions keep focus, default deletion to Cancel and restore the opener", async ({page}) => {
  const opener = page.locator('[data-message-id="seed-19"]').getByRole("button", {name: "Encrypted message actions"});
  await opener.click();
  const dialog = page.getByRole("dialog", {name: "Message actions", exact: true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", {name: "Delete", exact: true}).click();
  const confirmation = page.getByRole("dialog", {name: "Confirm message deletion"});
  await expect(confirmation.getByRole("button", {name: "Cancel", exact: true})).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirmation.getByRole("button", {name: "Delete message", exact: true})).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("reduced motion removes conversation entrance and message gesture animation", async ({page}) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  await expect(page.locator(".conversation-view")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".message-interaction").first()).toHaveCSS("transition-duration", "0s");
});

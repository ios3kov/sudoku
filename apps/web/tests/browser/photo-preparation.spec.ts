import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type {} from "./support/photo-preparation-fixture";
import type {} from "./support/audit-fixture";

const webRoot = path.resolve(__dirname, "../..");
const importFixture = new Function("url", "return import(url)") as (url: string) => Promise<{default: (entry: string) => Promise<string>}>;
let bundle: string, chat: string, styles: string;
test.beforeAll(async () => {
  const {default: build} = await importFixture(pathToFileURL(path.join(webRoot, "tests/browser/support/build-ux-fixture.mjs")).href);
  bundle = await build("photo-preparation-fixture.ts");
  chat = await build("audit-fixture.tsx");
  styles = (await Promise.all(["app/globals.css", "features/messenger/messenger-redesign.css", "features/messenger/messenger-ux3.css"].map(file => readFile(path.join(webRoot, file), "utf8")))).join("\n");
});
test.beforeEach(async ({page}) => {
  const url = "http://127.0.0.1:3000/__photo_fixture";
  await page.route(url, route => route.fulfill({contentType: "text/html", body: '<html><body><div id="root"></div></body></html>'}));
  await page.goto(url);
  await page.addScriptTag({content: bundle});
});

test("Standard reduces JPEG dimensions and bytes while Original preserves the selected file", async ({page}) => {
  const result = await page.evaluate(async () => {
    const input = await window.__photos.sample();
    const output = await window.__photos.preparePhoto(input, "standard");
    const bitmap = await createImageBitmap(output);
    const dimensions = [bitmap.width, bitmap.height];
    bitmap.close();
    return {dimensions, smaller: output.size < input.size, type: output.type, name: output.name,
      originalUnchanged: await window.__photos.preparePhoto(input, "original") === input};
  });
  expect(result).toEqual({dimensions: [2048, 1024], smaller: true, type: "image/jpeg", name: "photo.jpg", originalUnchanged: true});
});

test("other media keep their bytes and invalid JPEG fails instead of silently uploading", async ({page}) => {
  const result = await page.evaluate(async () => {
    const preserved = [];
    for (const type of ["image/png", "image/webp", "image/gif", "video/mp4", "application/pdf"]) {
      const file = new File(["selected bytes"], "attachment", {type});
      preserved.push(await window.__photos.preparePhoto(file, "standard") === file);
    }
    let error = "";
    try { await window.__photos.preparePhoto(new File(["broken"], "bad.jpg", {type: "image/jpeg"}), "standard"); }
    catch (reason) { error = (reason as Error).message; }
    return {preserved, error};
  });
  expect(result.preserved).toEqual([true, true, true, true, true]);
  expect(result.error).toContain("Select it again to send Original");
});

test("portrait EXIF orientation is preserved when resizing", async ({page}) => {
  const dimensions = await page.evaluate(async () => {
    const source = await window.__photos.sample();
    const bytes = new Uint8Array(await source.arrayBuffer());
    // APP1 Exif: little-endian TIFF, orientation = 6 (90 degrees clockwise).
    const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const input = new File([bytes.slice(0, 2), exif, bytes.slice(2)], "portrait.jpg", {type: "image/jpeg"});
    const output = await window.__photos.preparePhoto(input, "standard");
    const bitmap = await createImageBitmap(output);
    const value = [bitmap.width, bitmap.height];
    bitmap.close();
    return value;
  });
  expect(dimensions).toEqual([1024, 2048]);
});

test("oversized JPEG dimensions are rejected before bitmap decoding", async ({page}) => {
  const result = await page.evaluate(async () => {
    const original = window.createImageBitmap;
    let decoded = false;
    window.createImageBitmap = (() => { decoded = true; throw new Error("unexpected decode"); }) as typeof createImageBitmap;
    try {
      // SOF0 advertises 65535 by 65535 pixels in a tiny input.
      const file = new File([new Uint8Array([255,216,255,192,0,8,8,255,255,255,255,0])], "huge.jpg", {type: "image/jpeg"});
      let error = "";
      try { await window.__photos.preparePhoto(file, "standard"); } catch (reason) { error = (reason as Error).message; }
      return {decoded, error};
    } finally { window.createImageBitmap = original; }
  });
  expect(result.decoded).toBe(false);
  expect(result.error).toContain("too large to prepare safely");
});

test("photo choice sends nothing on Cancel and Standard reaches encrypted upload prepared", async ({page}) => {
  await page.addStyleTag({content: styles});
  await page.addScriptTag({content: chat});
  await page.evaluate(() => window.__predeployAudit.mount("chat"));
  await expect(page.getByRole("textbox", {name: "Message", exact: true})).toBeEnabled();
  const select = async () => page.locator('input[type="file"]').evaluate(async element => {
    const transfer = new DataTransfer();
    transfer.items.add(await window.__photos.sample());
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event("change", {bubbles: true}));
  });
  await select();
  const dialog = page.getByRole("dialog", {name: "Photo quality"});
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.__predeployAudit.io.uploads)).toBe(0);
  await dialog.getByRole("button", {name: "Cancel", exact: true}).click();
  expect(await page.evaluate(() => window.__predeployAudit.io.uploads)).toBe(0);
  await select();
  await dialog.getByRole("button", {name: "Send Standard"}).click();
  await expect.poll(() => page.evaluate(() => window.__predeployAudit.io.uploads)).toBe(1);
  const dimensions = await page.evaluate(async () => {
    const bitmap = await createImageBitmap(window.__predeployAudit.io.uploadedFiles[0]);
    const value = [bitmap.width, bitmap.height];
    bitmap.close();
    return value;
  });
  expect(dimensions).toEqual([2048, 1024]);
});

test("leaving the chat during photo preparation does not start an upload", async ({page}) => {
  await page.addStyleTag({content: styles});
  await page.addScriptTag({content: chat});
  await page.evaluate(() => window.__predeployAudit.mount("chat"));
  await expect(page.getByRole("textbox", {name: "Message", exact: true})).toBeEnabled();
  await page.locator('input[type="file"]').evaluate(async element => {
    const transfer = new DataTransfer();
    transfer.items.add(await window.__photos.sample());
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event("change", {bubbles: true}));
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = (async (blob: Blob, options: ImageBitmapOptions) => {
      const bitmap = await decode(blob, options);
      window.__photos.decodeStarted = true;
      await new Promise<void>(resolve => { window.__photos.resumeDecode = resolve; });
      return bitmap;
    }) as typeof createImageBitmap;
  });
  await page.getByRole("button", {name: "Send Standard"}).click();
  await expect.poll(() => page.evaluate(() => window.__photos.decodeStarted)).toBe(true);
  await page.evaluate(() => window.__predeployAudit.mount("voice"));
  await expect(page.getByRole("textbox", {name: "Message", exact: true})).toHaveCount(0);
  await page.evaluate(() => window.__photos.resumeDecode!());
  // Allow canvas encoding and the stale preparation continuation to finish.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__predeployAudit.io.uploads)).toBe(0);
});

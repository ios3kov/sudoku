import { expect, test } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {} from "./support/video-playback-fixture";
const importFixture = new Function("url", "return import(url)") as (url: string) => Promise<{default: (entry: string) => Promise<string>}>;
let bundle: string;
test.beforeAll(async () => {
  const {default: build} = await importFixture(pathToFileURL(path.resolve(__dirname, "support/build-ux-fixture.mjs")).href);
  bundle = await build("video-playback-fixture.tsx");
});
test.beforeEach(async ({page}) => {
  const url = "http://127.0.0.1:3000/__video_test";
  await page.route(url, route => route.fulfill({contentType: "text/html", body: '<div id="root"></div>'}));
  await page.goto(url);
  await page.addScriptTag({content: bundle});
});
test("native playback receives bounded local bytes and releases them after close", async ({page}) => {
  await page.evaluate(() => window.__videoTest.mount());
  await page.getByRole("button", {name: "Play video clip.mp4"}).click();
  await expect.poll(() => page.evaluate(() => window.__videoTest.calls.length)).toBe(1);
  const payload = await page.evaluate(() => window.__videoTest.calls[0]);
  expect(payload).toMatchObject({mimeType: "video/mp4", base64: "AQID"});
  await page.evaluate(() => window.__videoTest.finish());
  await expect(page.getByRole("button", {name: "Play video clip.mp4"})).toBeEnabled();
  expect(await page.evaluate(() => window.__videoTest.releases())).toBeGreaterThan(0);
});
test("unmount cancels only this native playback session", async ({page}) => {
  await page.evaluate(() => window.__videoTest.mount());
  await page.getByRole("button", {name: "Play video clip.mp4"}).click();
  await expect.poll(() => page.evaluate(() => window.__videoTest.calls.length)).toBe(1);
  const id = await page.evaluate(() => window.__videoTest.calls[0].id);
  await page.evaluate(() => window.__videoTest.unmount());
  expect(await page.evaluate(() => window.__videoTest.stops)).toEqual([id]);
});
test("late decryption cannot open a player after the attachment is closed", async ({page}) => {
  await page.evaluate(() => window.__videoTest.mount(true));
  await page.getByRole("button", {name: "Play video clip.mp4"}).click();
  await page.evaluate(() => { window.__videoTest.unmount(); window.__videoTest.provide(); });
  expect(await page.evaluate(() => window.__videoTest.calls)).toHaveLength(0);
});


test("web viewer decodes a real local clip and closes with Escape and page hide", async ({page}) => {
  await page.evaluate(() => window.__videoTest.mountWeb());
  const button = page.getByRole("button", {name: "Play video sample.webm"});
  await button.click();
  const viewer = page.getByRole("dialog", {name: "Video: sample.webm"});
  await expect(viewer).toBeVisible();
  await expect.poll(() => viewer.locator("video").evaluate(node => (node as HTMLVideoElement).videoWidth)).toBe(32);
  await page.keyboard.press("Escape");
  await expect(viewer).not.toBeVisible();
  await expect(button).toBeFocused();
  await button.click();
  await expect(viewer).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(viewer).not.toBeVisible();
  expect(await page.evaluate(() => window.__videoTest.releases())).toBeGreaterThanOrEqual(2);
});

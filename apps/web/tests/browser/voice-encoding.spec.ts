import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type {} from "./support/voice-encoding-fixture";

test("speech recorder produces compact decodable audio with a real browser encoder", async ({page}) => {
  const importFixture = new Function("url", "return import(url)") as (url: string) => Promise<{default: (entry: string) => Promise<string>}>;
  const {default: build} = await importFixture(pathToFileURL(path.resolve(__dirname, "support/build-ux-fixture.mjs")).href);
  const bundle = await build("voice-encoding-fixture.ts");
  const url = "http://127.0.0.1:3000/__voice_encoding";
  await page.route(url, route => route.fulfill({contentType: "text/html", body: '<button>Enable audio test</button>'}));
  await page.goto(url);
  await page.addScriptTag({content: bundle});
  await page.getByRole("button", {name: "Enable audio test"}).click();
  const sample = await page.evaluate(() => window.__voiceEncoding.recordSample());
  expect(sample.mime).toMatch(/^audio\/(mp4|webm)/);
  expect(sample.seconds).toBeGreaterThan(0.8);
  expect(sample.seconds).toBeLessThan(3);
  expect(sample.channels).toBe(1);
  expect(sample.audible).toBe(true);
  expect(sample.bytes).toBeGreaterThan(0);
  // A generous byte budget catches uncompressed output without assuming that
  // browsers honor the exact requested bitrate or share container overhead.
  expect(sample.bytes).toBeLessThan(64 * 1024);
});

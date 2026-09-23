import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import type {} from "./support/audit-fixture";
const webRoot = path.resolve(__dirname, "../..");
const importFixture = new Function("url", "return import(url)") as (url: string) => Promise<{default: (entry: string) => Promise<string>}>;
let bundle: string, styles: string;
test.use({ actionTimeout: 3_000 });
test.beforeAll(async () => {
  const {default: build} = await importFixture(pathToFileURL(path.join(webRoot,"tests/browser/support/build-ux-fixture.mjs")).href);
  bundle = await build("audit-fixture.tsx");
  styles = (await Promise.all(["app/globals.css", "features/messenger/messenger-redesign.css", "features/messenger/messenger-ux3.css"].map(file=>readFile(path.join(webRoot,file),"utf8")))).join("\n");
});
test.beforeEach(async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({content: styles});
  await page.addScriptTag({content: bundle});
});

test("late attachment decryption cannot create a blob after hiding", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("voice"));
  await page.getByRole("button",{name:"Load encrypted voice"}).click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.io.downloads.length)).toBe(1);
  await page.getByRole("button",{name:"Unmount private surface"}).click();
  expect(await page.evaluate(()=>window.__predeployAudit.io.downloads[0].signal?.aborted)).toBe(true);
  await page.evaluate(()=>window.__predeployAudit.resolveDownload());
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,30)));
  expect(await page.evaluate(()=>window.__predeployAudit.urls.created)).toEqual([]);
});

test("voice download failure is handled and can be retried", async ({page}) => {
  const errors: string[] = []; page.on("pageerror", error=>errors.push(error.message));
  await page.evaluate(()=>window.__predeployAudit.mount("voice"));
  await page.getByRole("button",{name:"Load encrypted voice"}).click();
  await page.evaluate(()=>window.__predeployAudit.rejectDownload());
  await expect(page.getByText("Encrypted attachment unavailable",{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
  await page.getByRole("button",{name:"Retry encrypted attachment",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.io.downloads.length)).toBe(2);
  await page.evaluate(()=>window.__predeployAudit.resolveDownload(1));
  await expect(page.locator("audio")).toBeVisible();
});

test("late microphone permission after hiding stops the newly acquired track", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  await page.locator(".voice-button").click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.media.requests.length)).toBe(1);
  await page.getByRole("button",{name:"Hide",exact:true}).click();
  await page.evaluate(()=>window.__predeployAudit.resolveMedia());
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,30)));
  expect(await page.evaluate(()=>window.__predeployAudit.media.activeTracks)).toBe(0);
  expect(await page.evaluate(()=>window.__predeployAudit.media.starts)).toBe(0);
});

test("repeated microphone activation cannot start concurrent acquisitions", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  const mic = page.locator(".voice-button");
  await expect(mic).toBeEnabled();
  await mic.evaluate((node)=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click();});
  expect(await page.evaluate(()=>window.__predeployAudit.media.requests.length)).toBe(1);
});

test("recorder construction failure releases an acquired microphone", async ({page}) => {
  await page.evaluate(()=>{window.__predeployAudit.media.throwOnConstruct=true;window.__predeployAudit.mount("chat");});
  await page.locator(".voice-button").click();
  await page.evaluate(()=>window.__predeployAudit.resolveMedia());
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await page.evaluate(()=>window.__predeployAudit.media.activeTracks)).toBe(0);
});

test("recording errors discard partial audio rather than send it", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  await page.locator(".voice-button").click();
  await page.evaluate(()=>window.__predeployAudit.resolveMedia());
  await expect(page.locator(".voice-button")).toContainText("Stop");
  await page.evaluate(()=>window.__predeployAudit.media.recorders[0].fail());
  await expect(page.getByRole("alert")).toContainText("Voice recording failed");
  expect(await page.evaluate(()=>window.__predeployAudit.io.uploads)).toBe(0);
  expect(await page.evaluate(()=>window.__predeployAudit.media.activeTracks)).toBe(0);
});

test("transport failure never disables the microphone Stop control", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  await page.locator(".voice-button").click();
  await page.evaluate(()=>window.__predeployAudit.resolveMedia());
  await expect(page.locator(".voice-button")).toContainText("Stop");
  await page.evaluate(()=>{window.__predeployAudit.protocol.blocked=true;window.dispatchEvent(new Event("online"));});
  await expect(page.getByRole("alert")).toContainText("Secure sync is blocked");
  await expect(page.locator(".voice-button")).toBeEnabled({timeout:1000});
  await page.locator(".voice-button").click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.media.activeTracks)).toBe(0);
  expect(await page.evaluate(()=>window.__predeployAudit.protocol.sends)).toBe(0);
});

test("normal recording stops once, releases tracks and sends exactly once", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  await page.locator(".voice-button").click();await page.evaluate(()=>window.__predeployAudit.resolveMedia());
  await expect(page.locator(".voice-button")).toContainText("Stop");await page.locator(".voice-button").click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.protocol.sends)).toBe(1);
  expect(await page.evaluate(()=>window.__predeployAudit.media.activeTracks)).toBe(0);
  expect(await page.evaluate(()=>window.__predeployAudit.io.uploads)).toBe(1);
});
test("hiding an active recording discards it and releases all tracks", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));await page.locator(".voice-button").click();
  await page.evaluate(()=>window.__predeployAudit.resolveMedia());await expect(page.locator(".voice-button")).toContainText("Stop");
  await page.getByRole("button",{name:"Hide",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.media.activeTracks)).toBe(0);
  expect(await page.evaluate(()=>window.__predeployAudit.protocol.sends)).toBe(0);
});
test("hiding loaded media revokes its URL", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("voice"));await page.getByRole("button",{name:"Load encrypted voice"}).click();
  await page.evaluate(()=>window.__predeployAudit.resolveDownload());await expect(page.locator("audio")).toBeVisible();
  await page.getByRole("button",{name:"Unmount private surface"}).click();
  const urls = await page.evaluate(()=>window.__predeployAudit.urls);
  expect(urls.created).toHaveLength(1);expect(urls.revoked).toEqual(urls.created);
});

for (const [width,height] of [[320,568],[390,844],[844,390],[768,1024]]) {
  test(`actual chat fits ${width}x${height} with long text and an accessible action dialog`, async ({page}) => {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>{window.__predeployAudit.seedHistory();window.__predeployAudit.mount("chat");});
    await expect(page.locator('[data-message-id="seed-19"]')).toBeVisible();
    const geometry = await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,history:document.querySelector(".message-list")!.getBoundingClientRect().height}));
    expect(geometry.body).toBeLessThanOrEqual(width);expect(geometry.history).toBeGreaterThan(120);
    const controls = page.locator(".composer button, .chat-header-actions button, .back-button");
    for (const item of await controls.all()) {
      const box = await item.boundingBox();expect(box).not.toBeNull();
      expect(Math.round(box!.height)).toBeGreaterThanOrEqual(44);expect(Math.round(box!.width)).toBeGreaterThanOrEqual(44);
    }
    const inputBox = await page.locator(".composer textarea").boundingBox();
    expect(inputBox!.y+inputBox!.height).toBeLessThanOrEqual(height);
    await page.locator('[data-message-id="seed-19"]').getByRole("button",{name:"Encrypted message actions"}).click();
    const dialog=page.getByRole("dialog",{name:"Message actions",exact:true});await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
    await page.emulateMedia({reducedMotion:"reduce"});
    expect(await page.locator(".message-interaction").first().evaluate(node=>parseFloat(getComputedStyle(node).transitionDuration))).toBeLessThanOrEqual(0.00002);
  });
}


test("encrypted file and image buttons start the real decrypt/download flow", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("file"));
  await page.locator("button.file-attachment").click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.io.downloads.length)).toBe(1);
  await page.evaluate(()=>window.__predeployAudit.resolveDownload());
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.urls.created.length)).toBe(1);

  await page.evaluate(() => {
    class IdleIntersectionObserver {
      root = null; rootMargin = "0px"; thresholds = [0];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: IdleIntersectionObserver,
    });
  });
  await page.evaluate(()=>window.__predeployAudit.mount("image"));
  const image = page.getByRole("button",{name:/Open encrypted image/});
  await expect(image).toBeVisible();
  await image.click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.io.downloads.length)).toBe(2);
  await page.evaluate(()=>window.__predeployAudit.resolveDownload(1));
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.urls.created.length)).toBeGreaterThanOrEqual(2);
});

test("encrypted Attach button opens the hidden file picker", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  const input = page.locator('input[type="file"]');
  await input.evaluate((node) => node.addEventListener("click", () => node.setAttribute("data-audit-clicked", "true")));
  await page.getByRole("button",{name:"Attach encrypted file",exact:true}).click();
  await expect(input).toHaveAttribute("data-audit-clicked", "true");
});

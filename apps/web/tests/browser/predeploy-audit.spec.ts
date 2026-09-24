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
  await page.getByRole("button",{name:"Play voice message"}).click();
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
  await page.getByRole("button",{name:"Play voice message"}).click();
  await page.evaluate(()=>window.__predeployAudit.rejectDownload());
  await expect(page.getByText("Encrypted attachment unavailable",{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
  await page.getByRole("button",{name:"Retry encrypted attachment",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.io.downloads.length)).toBe(2);
  await page.evaluate(()=>window.__predeployAudit.resolveDownload(1));
  await expect(page.getByRole("button",{name:"Play voice message"})).toBeVisible();
});

test("encrypted typing coalesces keystrokes, refreshes while active and stops cleanly", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  const input = page.getByRole("textbox",{name:"Message"});
  await expect(input).toBeEnabled();

  for (const value of ["h", "he", "hel", "hell"]) {
    await input.fill(value);
    await page.waitForTimeout(600);
  }

  const activeFrames = await page.evaluate(() => window.__predeployAudit.protocol.typing);
  const activeCount = activeFrames.filter((frame) => frame.active).length;
  expect(activeCount).toBeGreaterThanOrEqual(2);
  expect(activeCount).toBeLessThan(4);
  expect(activeFrames.some((frame) => !frame.active)).toBe(false);

  await input.fill("");
  await expect.poll(() => page.evaluate(() => window.__predeployAudit.protocol.typing.at(-1)?.active)).toBe(false);
});

test("encrypted typing stops on hide and remote presence has names plus fail-safe expiry", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  const input = page.getByRole("textbox",{name:"Message"});
  await expect(input).toBeEnabled();
  await input.fill("draft");
  await expect.poll(() => page.evaluate(() => window.__predeployAudit.protocol.typing.at(-1)?.active)).toBe(true);

  await page.evaluate(() => window.__predeployAudit.emitRealtime({
    type: "typing.started",
    conversation_id: "chat",
    payload: { user_id: "peer" },
  }));
  await expect(page.getByText("Alice is typing…",{exact:true})).toBeVisible();

  await page.evaluate(() => window.__predeployAudit.emitRealtime({
    type: "typing.stopped",
    conversation_id: "chat",
    payload: { user_id: "peer" },
  }));
  await expect(page.getByText("Alice is typing…",{exact:true})).toHaveCount(0);

  await page.evaluate(() => window.__predeployAudit.emitRealtime({
    type: "typing.started",
    conversation_id: "chat",
    payload: { user_id: "peer" },
  }));
  await expect(page.getByText("Alice is typing…",{exact:true})).toBeVisible();
  await page.waitForTimeout(3_700);
  await expect(page.getByText("Alice is typing…",{exact:true})).toHaveCount(0);

  await input.fill("still typing");
  await page.getByRole("button",{name:"Hide",exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.__predeployAudit.protocol.typing.at(-1)?.active)).toBe(false);
});

test("encrypted read watermark skips duplicate writes and advances once for a newer visible message", async ({page}) => {
  await page.evaluate(() => {
    window.__predeployAudit.seedHistory();
    window.__predeployAudit.mount("chat");
  });
  await expect(page.locator('[data-message-id="seed-19"]')).toBeVisible();
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => window.__predeployAudit.protocol.reads)).toEqual([]);

  await page.evaluate(() => {
    window.__predeployAudit.protocol.messages.push({
      id: "seed-20",
      sequence: 21,
      senderId: "peer",
      messageType: "text",
      body: "Newest visible message",
      createdAt: "2026-09-22T08:21:00Z",
      replyTo: null,
      assetIds: [],
      attachments: [],
      reactions: [],
      edited: false,
      deleted: false,
    });
    window.__predeployAudit.emitRealtime({
      type: "message.created",
      conversation_id: "chat",
      payload: { sender_id: "peer", sequence: 21 },
    });
  });

  await expect(page.locator('[data-message-id="seed-20"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__predeployAudit.protocol.reads)).toEqual([21]);

  await page.evaluate(() => window.__predeployAudit.emitRealtime({
    type: "message.created",
    conversation_id: "chat",
    payload: { sender_id: "peer", sequence: 21 },
  }));
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => window.__predeployAudit.protocol.reads)).toEqual([21]);
});

test("encrypted typing clears only for a real decrypted message, not a reaction/edit envelope", async ({page}) => {
  await page.evaluate(()=>{
    window.__predeployAudit.seedHistory();
    window.__predeployAudit.mount("chat");
  });
  await expect(page.locator('[data-message-id="seed-19"]')).toBeVisible();

  await page.evaluate(() => window.__predeployAudit.emitRealtime({
    type: "typing.started",
    conversation_id: "chat",
    payload: { user_id: "peer" },
  }));
  await expect(page.getByText("Alice is typing…",{exact:true})).toBeVisible();

  // Encrypted reaction/edit/delete application events are also transported as
  // server message.created rows. If the decrypted projection has no message
  // with that event id, typing must remain visible.
  await page.evaluate(() => window.__predeployAudit.emitRealtime({
    type: "message.created",
    conversation_id: "chat",
    payload: { id: "encrypted-reaction-event", sender_id: "peer", sequence: 21 },
  }));
  await page.waitForTimeout(80);
  await expect(page.getByText("Alice is typing…",{exact:true})).toBeVisible();

  await page.evaluate(() => {
    window.__predeployAudit.protocol.messages.push({
      id: "typing-message",
      sequence: 21,
      senderId: "peer",
      messageType: "text",
      body: "Actual new message",
      createdAt: "2026-09-22T08:21:00Z",
      replyTo: null,
      assetIds: [],
      attachments: [],
      reactions: [],
      edited: false,
      deleted: false,
    });
    window.__predeployAudit.emitRealtime({
      type: "message.created",
      conversation_id: "chat",
      payload: { id: "typing-message", sender_id: "peer", sequence: 21 },
    });
  });
  await expect(page.locator('[data-message-id="typing-message"]')).toBeVisible();
  await expect(page.getByText("Alice is typing…",{exact:true})).toHaveCount(0);

  await expect(
    page.locator('[data-message-id="seed-19"] .message-delivery')
  ).toHaveAttribute("title","Read by Alice");
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
  await expect(page.getByRole("group",{name:"Voice message preview"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Send voice message"})).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Secure sync is blocked");
  expect(await page.evaluate(()=>window.__predeployAudit.protocol.sends)).toBe(0);
});

test("normal recording becomes a local preview and explicit Send happens exactly once", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  await page.locator(".voice-button").click();
  await page.evaluate(()=>window.__predeployAudit.resolveMedia());
  await expect(page.locator(".voice-button")).toContainText("Stop");
  await page.locator(".voice-button").click();

  const preview = page.getByRole("group",{name:"Voice message preview"});
  await expect(preview).toBeVisible();
  await expect(page.getByRole("slider",{name:"Voice preview position"})).toBeVisible();
  expect(await page.evaluate(()=>window.__predeployAudit.media.activeTracks)).toBe(0);
  expect(await page.evaluate(()=>window.__predeployAudit.io.uploads)).toBe(0);
  expect(await page.evaluate(()=>window.__predeployAudit.protocol.sends)).toBe(0);

  const send = page.getByRole("button",{name:"Send voice message"});
  await send.evaluate((node)=>{
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });

  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.io.uploads)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.protocol.sends)).toBe(1);
  await expect(preview).toHaveCount(0);

  const lastSend = await page.evaluate(()=>window.__predeployAudit.protocol.lastSend) as {
    attachments?: Array<{voice?: {durationMs?: number; waveform?: number[]}}>;
  };
  expect(lastSend.attachments?.[0]?.voice?.durationMs).toBeGreaterThan(0);
  expect(lastSend.attachments?.[0]?.voice?.waveform).toEqual([]);

  const urls = await page.evaluate(()=>window.__predeployAudit.urls);
  expect(urls.created.length).toBeGreaterThan(0);
  expect(urls.revoked).toContain(urls.created.at(-1));
});

test("deleting a voice draft never uploads or sends and revokes its preview URL", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  await page.locator(".voice-button").click();
  await page.evaluate(()=>window.__predeployAudit.resolveMedia());
  await page.locator(".voice-button").click();

  const preview = page.getByRole("group",{name:"Voice message preview"});
  await expect(preview).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.urls.created.length)).toBeGreaterThan(0);
  const created = await page.evaluate(()=>window.__predeployAudit.urls.created.at(-1));

  await page.getByRole("button",{name:"Delete voice draft"}).click();
  await expect(preview).toHaveCount(0);
  expect(await page.evaluate(()=>window.__predeployAudit.io.uploads)).toBe(0);
  expect(await page.evaluate(()=>window.__predeployAudit.protocol.sends)).toBe(0);
  expect(await page.evaluate((url)=>window.__predeployAudit.urls.revoked.includes(url!), created)).toBe(true);
});
test("hiding an unsent voice draft revokes its preview URL without upload", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  await page.locator(".voice-button").click();
  await page.evaluate(()=>window.__predeployAudit.resolveMedia());
  await page.locator(".voice-button").click();
  await expect(page.getByRole("group",{name:"Voice message preview"})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.urls.created.length)).toBeGreaterThan(0);
  const created = await page.evaluate(()=>window.__predeployAudit.urls.created.at(-1));

  await page.getByRole("button",{name:"Hide",exact:true}).click();
  expect(await page.evaluate(()=>window.__predeployAudit.io.uploads)).toBe(0);
  expect(await page.evaluate(()=>window.__predeployAudit.protocol.sends)).toBe(0);
  expect(await page.evaluate((url)=>window.__predeployAudit.urls.revoked.includes(url!), created)).toBe(true);
});

test("hiding an active recording discards it and releases all tracks", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));await page.locator(".voice-button").click();
  await page.evaluate(()=>window.__predeployAudit.resolveMedia());await expect(page.locator(".voice-button")).toContainText("Stop");
  await page.getByRole("button",{name:"Hide",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.media.activeTracks)).toBe(0);
  expect(await page.evaluate(()=>window.__predeployAudit.protocol.sends)).toBe(0);
});
test("hiding loaded media revokes its URL", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("voice"));
  await page.getByRole("button",{name:"Play voice message"}).click();
  await page.evaluate(()=>window.__predeployAudit.resolveDownload());
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.urls.created.length)).toBe(1);
  await expect(page.getByRole("button",{name:"Play voice message"})).toBeVisible();
  await page.getByRole("button",{name:"Unmount private surface"}).click();
  const urls = await page.evaluate(()=>window.__predeployAudit.urls);
  expect(urls.created).toHaveLength(1);
  expect(urls.revoked).toEqual(urls.created);
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

test("encrypted file and image buttons start the decrypt/download flow", async ({page}) => {
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
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: IdleIntersectionObserver });
  });
  await page.evaluate(()=>window.__predeployAudit.mount("image"));
  const image = page.getByRole("button",{name:/Open encrypted image/});
  await image.click();
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.io.downloads.length)).toBe(2);
  await page.evaluate(()=>window.__predeployAudit.resolveDownload(1));
  await expect.poll(()=>page.evaluate(()=>window.__predeployAudit.urls.created.length)).toBeGreaterThanOrEqual(2);
});

test("encrypted attach button opens the hidden file picker", async ({page}) => {
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));
  const input = page.locator('input[type="file"]');
  await input.evaluate((node) => node.addEventListener("click", () => node.setAttribute("data-audit-clicked", "true")));
  await page.getByRole("button",{name:"Attach encrypted file",exact:true}).click();
  await expect(input).toHaveAttribute("data-audit-clicked", "true");
});


test("encrypted attach button prefers the native iOS picker bridge when available", async ({page}) => {
  await page.evaluate(() => {
    const state = window as unknown as {
      __nativePickerCalled?: boolean;
      SudokuNativeMedia?: { pickAttachment: () => Promise<never> };
    };
    state.__nativePickerCalled = false;
    state.SudokuNativeMedia = {
      pickAttachment: async () => {
        state.__nativePickerCalled = true;
        throw new DOMException("User canceled", "AbortError");
      },
    };
    window.dispatchEvent(new Event("sudoku:native-media-ready"));
  });
  await page.evaluate(()=>window.__predeployAudit.mount("chat"));

  const input = page.locator('input[type="file"]');
  await input.evaluate((node) => node.addEventListener("click", () => node.setAttribute("data-audit-clicked", "true")));

  await page.getByRole("button",{name:"Attach encrypted file",exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __nativePickerCalled?: boolean }).__nativePickerCalled)).toBe(true);
  await expect(input).not.toHaveAttribute("data-audit-clicked", "true");
});

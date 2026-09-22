import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const webRoot = path.resolve(__dirname, "../..");
// Native import is retained for the test-only ESM compiler even when Playwright
// transpiles this TypeScript spec to CommonJS.
const importFixture = new Function("url", "return import(url)") as (url: string) => Promise<{ default: () => Promise<string> }>;
test.use({ actionTimeout: 5_000 });
let bundle: string;
let styles: string;
test.beforeAll(async () => {
  const { default: buildFixture } = await importFixture(pathToFileURL(path.join(webRoot, "tests/browser/support/build-ux-fixture.mjs")).href);
  bundle = await buildFixture();
  styles = (await Promise.all(["app/globals.css", "features/messenger/messenger-redesign.css", "features/messenger/messenger-ux3.css"].map((file) => readFile(path.join(webRoot, file), "utf8")))).join("\n");
});
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(page.locator('[data-message-id="m140"]')).toBeVisible();
});

async function pointer(node: Locator, type: string, x = 100, y = 100, pointerId = 1, isPrimary = true) {
  await node.dispatchEvent(type, {pointerType:"touch",pointerId,isPrimary,button:0,buttons:type === "pointerup" ? 0 : 1,clientX:x,clientY:y});
}
async function anchor(page: Page) {
  return page.locator(".message-list").evaluate((node) => {
    const top=node.getBoundingClientRect().top;
    const item=[...node.querySelectorAll<HTMLElement>("[data-message-id]")].find((entry)=>entry.getBoundingClientRect().bottom>top+1)!;
    return {id:item.dataset.messageId!,offset:item.getBoundingClientRect().top-top};
  });
}
async function expectAnchor(page: Page, previous: {id:string;offset:number}) {
  await expect.poll(() => page.locator(`[data-message-id="${previous.id}"]`).evaluate((node) => node.getBoundingClientRect().top-node.closest(".message-list")!.getBoundingClientRect().top)).toBeCloseTo(previous.offset,0);
}

test("timeline has real dates, groups and a bounded visible window", async ({ page }) => {
  await expect(page.locator("[data-message-id]")).toHaveCount(120);
  await expect(page.locator(".message-date-separator")).toHaveCount(1);
  await expect(page.locator(".timeline-item.grouped").first()).toBeAttached();
  await expect(page.locator('[data-message-id="m140"] time')).toHaveAttribute("datetime",initialTime(139));
  await expect(page.locator(".message-time").filter({ hasText: "#" })).toHaveCount(0);
  const widths=await page.evaluate(()=>({viewport:innerWidth,body:document.body.scrollWidth}));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
});
function initialTime(index: number) {return new Date(Date.UTC(2026,8,21,10,index)).toISOString();}

test("drafts survive switching, edits do not overwrite them, hide and account change clear them", async ({ page }) => {
  const composer=page.getByLabel("Message",{exact:true});
  await composer.fill("draft A");await page.getByRole("button",{name:"Chat B",exact:true}).click();
  await expect(composer).toHaveValue("");await composer.fill("draft B");
  await page.getByRole("button",{name:"Chat A",exact:true}).click();await expect(composer).toHaveValue("draft A");
  await page.getByRole("button",{name:"Actions m139",exact:true}).click();
  await page.getByRole("button",{name:"Edit",exact:true}).click();await expect(composer).toBeFocused();
  await composer.fill("edited text");await page.getByRole("button",{name:"Cancel edit",exact:true}).click();
  await expect(composer).toHaveValue("draft A");
  await page.getByRole("button",{name:"Hide",exact:true}).click();await expect(composer).toHaveCount(0);
  await page.getByRole("button",{name:"Show",exact:true}).click();await expect(composer).toHaveValue("");
  await composer.fill("account one");await page.getByRole("button",{name:"Change account",exact:true}).click();await expect(composer).toHaveValue("");
});

test("action sheet traps keyboard focus and confirms deletion", async ({ page }) => {
  const actions=page.getByRole("button",{name:"Actions m139",exact:true});
  await actions.click();const dialog=page.getByRole("dialog",{name:"Message actions",exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button",{name:"Reply",exact:true})).toBeFocused();
  await page.keyboard.press("Shift+Tab");await expect(dialog.getByRole("button",{name:"Cancel",exact:true})).toBeFocused();
  await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(actions).toBeFocused();
  await actions.click();await page.getByRole("button",{name:"Delete",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Confirm message deletion",exact:true})).toBeVisible();
  await expect(page.locator('[data-message-id="m139"]')).toBeAttached();
  await page.getByRole("button",{name:"Cancel",exact:true}).click();await expect(page.locator('[data-message-id="m139"]')).toBeAttached();
  await actions.click();await page.getByRole("button",{name:"Delete",exact:true}).click();await page.getByRole("button",{name:"Delete message",exact:true}).click();
  await expect(page.locator('[data-message-id="m139"]')).toHaveCount(0);
});

test("long press opens actions; media, vertical scroll and multitouch never do", async ({ page }) => {
  await page.clock.install();
  const node=page.locator('[data-message-id="m139"] .message-interaction');
  await pointer(node,"pointerdown");await page.clock.fastForward(500);
  await expect(page.getByRole("dialog",{name:"Message actions",exact:true})).toBeVisible();await page.keyboard.press("Escape");
  await pointer(node,"pointerup");
  await pointer(node,"pointerdown");await pointer(node,"pointermove",103,160);await page.clock.fastForward(500);await pointer(node,"pointerup",103,160);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const media=page.getByRole("button",{name:"Media control",exact:true});await pointer(media,"pointerdown");await page.clock.fastForward(500);await pointer(media,"pointerup");await expect(page.getByRole("dialog")).toHaveCount(0);
  await pointer(node,"pointerdown");await page.evaluate(()=>window.dispatchEvent(new PointerEvent("pointerdown",{pointerId:2,pointerType:"touch",isPrimary:false})));
  await page.clock.fastForward(500);await pointer(node,"pointermove",180,100);await pointer(node,"pointerup",180,100);
  await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.getByText("Reply m139",{exact:true})).toHaveCount(0);
});

test("only a completed rightward 64px swipe replies, and cancel returns the bubble", async ({ page }) => {
  const node=page.locator('[data-message-id="m139"] .message-interaction');
  await pointer(node,"pointerdown");await pointer(node,"pointermove",163,100);await pointer(node,"pointerup",163,100);
  await expect(page.getByText("Reply m139",{exact:true})).toHaveCount(0);
  await pointer(node,"pointerdown");await pointer(node,"pointermove",180,100);await pointer(node,"pointercancel",180,100);
  await expect(page.getByText("Reply m139",{exact:true})).toHaveCount(0);
  await expect(node).not.toHaveClass(/is-reply-dragging/);
  await pointer(node,"pointerdown");await pointer(node,"pointermove",164,100);await pointer(node,"pointerup",164,100);
  await expect(page.getByText("Reply m139",{exact:true})).toBeVisible();await expect(page.getByLabel("Message",{exact:true})).toBeFocused();
});

test("older history stays anchored through arrivals, expansion and media resize", async ({ page }) => {
  const history=page.locator(".message-list");
  await expect.poll(()=>page.evaluate(()=>window.__uxFixture.reads.at(-1))).toBe(140);
  await history.evaluate((node)=>{node.scrollTop=500;node.dispatchEvent(new Event("scroll"));});
  await expect(page.getByRole("button",{name:"Jump to latest",exact:true})).toBeVisible();
  const previous=await anchor(page);
  await page.evaluate(()=>window.__uxFixture.append());
  await expect(page.getByRole("button",{name:"1 new messages. Jump to latest",exact:true})).toBeVisible();
  await expectAnchor(page,previous);await expect(page.locator("[data-message-id]")).toHaveCount(120);
  await page.evaluate(()=>window.__uxFixture.append(true));await expectAnchor(page,previous);
  await expect(page.getByRole("button",{name:"1 new messages. Jump to latest",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__uxFixture.reads.at(-1))).toBe(140);
  await page.evaluate(()=>window.__uxFixture.prepend());await expectAnchor(page,previous);
  await page.evaluate(()=>window.__uxFixture.resizeAbove());await expectAnchor(page,previous);
  await page.getByRole("button",{name:"1 new messages. Jump to latest",exact:true}).click();
  await expect(page.locator('[data-message-id="m150"]')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__uxFixture.reads.at(-1))).toBe(150);
});

test("reply gesture cancels when it turns vertical or ends below the threshold", async ({ page }) => {
  const node = page.locator('[data-message-id="m139"] .message-interaction');
  await pointer(node, "pointerdown");
  await pointer(node, "pointermove", 180, 100);
  await pointer(node, "pointermove", 185, 250);
  await pointer(node, "pointerup", 185, 250);
  await expect(page.getByText("Reply m139", { exact: true })).toHaveCount(0);
  await pointer(node, "pointerdown");
  await pointer(node, "pointermove", 180, 100);
  // The last coalesced move can be older than the actual release coordinates.
  await pointer(node, "pointerup", 150, 100);
  await expect(page.getByText("Reply m139", { exact: true })).toHaveCount(0);
});

test("repeated history jumps work within the same rendered window", async ({ page }) => {
  const distanceFromCenter = (sequence: number) => page.locator(`[data-message-sequence="${sequence}"]`).evaluate((node) => {
    const viewport = node.closest(".message-list")!;
    return node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientHeight / 2;
  });
  await page.evaluate(() => window.__uxFixture.jump(100));
  await expect.poll(() => distanceFromCenter(100)).toBeCloseTo(0, 0);
  await page.evaluate(() => window.__uxFixture.jump(110));
  await expect.poll(() => distanceFromCenter(110)).toBeCloseTo(0, 0);
});

test("a delayed programmatic scroll event cannot replace the pre-resize anchor", async ({ page }) => {
  const history = page.locator(".message-list");
  await history.evaluate((node) => { node.scrollTop = 500; node.dispatchEvent(new Event("scroll")); });
  await expect(page.getByRole("button", { name: "Jump to latest", exact: true })).toBeVisible();
  const previous = await anchor(page);
  await page.evaluate(() => window.__uxFixture.prepend());
  await expectAnchor(page, previous);
  await page.evaluate(() => {
    window.__uxFixture.resizeAbove();
    // An earlier scrollTop correction has already positioned the reader. Its
    // queued scroll event can arrive after media layout but before ResizeObserver.
    // No additional user scroll has happened: the viewport scrollTop is unchanged.
    document.querySelector(".message-list")!.dispatchEvent(new Event("scroll"));
  });
  await expectAnchor(page, previous);
  // Genuine new user motion must still update the anchor and leave the tail.
  await history.evaluate((node) => { node.scrollTop += 150; node.dispatchEvent(new Event("scroll")); });
  const moved = await anchor(page);
  expect(moved.id).not.toBe(previous.id);
  await page.evaluate(() => window.__uxFixture.append());
  await expectAnchor(page, moved);
});

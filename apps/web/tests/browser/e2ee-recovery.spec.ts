import { expect, test, type Page } from "@playwright/test";
import { observeRealtimeSocket, verifyActiveComposition } from "./support/active-composition";

const OWNER_EMAIL = "browser-owner@example.com";
const PEER_EMAIL = "browser-peer@example.com";
const PASSWORD = "browser acceptance password";

async function unlockPrivate(page: Page) {
  await page.goto("/");
  const five = page.getByRole("button", { name: "5", exact: true });
  await expect(five).toBeVisible();

  // Dispatch the real 50%-threshold gesture. The available swipe path runs
  // from the digit's current Y position to the top edge; crossing 50% lets the
  // finishing animation take over automatically.
  const box = await five.boundingBox();
  expect(box).not.toBeNull();
  const startX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const startY = (box?.y ?? 0) + (box?.height ?? 0) / 2;

  await five.dispatchEvent("pointerdown", {
    clientX: startX,
    clientY: startY,
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await five.dispatchEvent("pointermove", {
    clientX: startX + 1,
    clientY: startY * 0.45,
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });

  await expect(page.locator(".messenger-lock, .messenger-page").first()).toBeVisible();
  await expect(page.locator(".private-reveal-layer")).not.toHaveAttribute("inert", "", {
    timeout: 5_000,
  });
}

async function login(page: Page, email: string) {
  await unlockPrivate(page);
  const emailInput = page.getByLabel("Email");

  await expect(emailInput).toBeVisible({ timeout: 30_000 });
  await emailInput.fill(email);
  await page.getByLabel("Password").fill(PASSWORD);

  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(signIn).toBeEnabled();

  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/v1/auth/login")
        && response.request().method() === "POST",
      { timeout: 30_000 },
    ),
    signIn.click({ timeout: 30_000 }),
  ]);
  expect(loginResponse.status()).toBe(200);

  await expect(page.getByText("Messages", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".messenger-runtime-shell")).toBeVisible();
  await expect(page.getByLabel("Search conversations")).toBeVisible();

  const runtimeShellWidth = await page.locator(".messenger-runtime-shell").evaluate(
    (element) => Math.round(element.getBoundingClientRect().width),
  );
  expect(runtimeShellWidth).toBeLessThanOrEqual(460);
  await expect(page.locator(".messenger-reveal-preview")).toHaveCount(0);

  // The first browser MLS initialization generates and publishes a KeyPackage
  // pool in WASM. On cold GitHub runners this can be materially slower than
  // ordinary UI hydration, so assert the real readiness signal instead of
  // treating cryptographic startup as a 60s rendering deadline.
  const newChat = page.getByRole("button", { name: "New secure chat" });
  await expect(newChat).toBeVisible({ timeout: 120_000 });
  await expect(newChat).toBeEnabled({ timeout: 120_000 });
}

async function reopenMessenger(page: Page) {
  await page.reload();
  await unlockPrivate(page);
  await expect(page.getByText("Messages", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

async function openConversation(page: Page, peerName: string) {
  const item = page.locator(".conversation-item").filter({ hasText: peerName });
  await expect(item).toBeVisible({ timeout: 60_000 });
  await item.click();
  await expect(page.getByText("End-to-end encrypted", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

async function sendText(page: Page, value: string) {
  const composer = page.locator("textarea").last();
  await expect(composer).toBeEnabled();
  await composer.fill(value);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("MLS survives reload, offline retry and fails closed on transport outage", async ({ browser }) => {
  // Cold GitHub runners can spend several minutes compiling/initializing two
  // independent OpenMLS browser sessions. Keep each functional assertion
  // individually bounded below, but leave enough aggregate headroom so the
  // suite fails on the real assertion rather than the outer test clock.
  test.setTimeout(480_000);
  const ownerContext = await browser.newContext();
  const peerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const peer = await peerContext.newPage();

  try {
    await observeRealtimeSocket(peer);
    // Peer must publish a KeyPackage before the owner bootstraps the direct chat.
    await login(peer, PEER_EMAIL);
    await login(owner, OWNER_EMAIL);

    let directoryRequests = 0;
    owner.on("request", (request) => {
      if (request.url().includes("/v1/users?q=")) directoryRequests += 1;
    });

    await owner.getByRole("button", { name: "New secure chat" }).click();
    await expect(owner.getByRole("dialog", { name: "Create secure chat" })).toBeVisible();
    await expect(owner.getByText("Type at least 2 characters to search.", { exact: true })).toBeVisible();
    await expect(owner.getByRole("button", { name: "Direct", exact: true })).toHaveAttribute("aria-pressed", "true");

    const peopleSearch = owner.getByPlaceholder("Search people");
    await peopleSearch.fill("B");
    await owner.waitForTimeout(300);
    expect(directoryRequests).toBe(0);

    await peopleSearch.fill("Browser Peer");
    const peerResult = owner.locator(".directory-item").filter({ hasText: PEER_EMAIL });
    await expect(peerResult).toBeVisible();
    expect(directoryRequests).toBeGreaterThan(0);
    await peerResult.click();

    await expect(owner.getByText("End-to-end encrypted", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    const composer = owner.locator("textarea").last();
    await expect(composer).toBeEnabled({ timeout: 60_000 });
    const initialComposerHeight = await composer.evaluate((element) =>
      Math.round(element.getBoundingClientRect().height),
    );
    await composer.fill("one\ntwo\nthree");
    const expandedComposerHeight = await composer.evaluate((element) =>
      Math.round(element.getBoundingClientRect().height),
    );
    expect(expandedComposerHeight).toBeGreaterThan(initialComposerHeight);
    await composer.fill("");

    await sendText(owner, "persisted before reload");
    await expect(owner.getByText("persisted before reload", { exact: true })).toBeVisible();

    // Do not depend on realtime: reload must recover the assigned Welcome and
    // persisted OpenMLS/IndexedDB state by itself.
    await reopenMessenger(peer);
    await openConversation(peer, "Browser Owner");
    await expect(peer.getByText("persisted before reload", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    // A second reload proves the joined group/provider state is persisted,
    // rather than reconstructed from a one-off Welcome.
    await reopenMessenger(peer);
    await openConversation(peer, "Browser Owner");
    await expect(peer.getByText("persisted before reload", { exact: true })).toBeVisible();

    // Offline application sends must be encrypted + persisted locally and
    // delivered with the same client id/ciphertext after reconnect.
    await ownerContext.setOffline(true);
    await sendText(owner, "queued while offline");
    await expect(owner.getByText("Encrypted message queued for retry", { exact: true }))
      .toBeVisible();
    await ownerContext.setOffline(false);

    await expect(owner.getByText("queued while offline", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    // Recipient catches up without relying on push/realtime.
    await peer.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(peer.getByText("queued while offline", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    // Keep markRead pending after a successful projection. An online event
    // during this exact window used to reuse the old refresh and lose the
    // notification entirely (post-merge CI #277).
    const readPattern = "**/v1/conversations/*/read";
    const transportPattern = "**/v1/e2ee/conversations/**/transport-events**";
    let releaseReadReceipt!: () => void;
    const readReceiptGate = new Promise<void>((resolve) => { releaseReadReceipt = resolve; });
    let readReceiptHeld = false;
    let blockedRequests = 0;
    await peer.route(readPattern, async (route) => {
      if (!readReceiptHeld) {
        readReceiptHeld = true;
        await readReceiptGate;
      }
      await route.continue();
    });

    try {
      await peer.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect.poll(() => readReceiptHeld).toBe(true);
      await expect(peer.locator("textarea").last()).toBeEnabled();

      // Already-decrypted history stays visible, but the follow-up must make
      // an actual transport request and fail closed for new authoring.
      await peer.route(transportPattern, (route) => {
        blockedRequests += 1;
        return route.abort();
      });
      await peer.evaluate(() => window.dispatchEvent(new Event("online")));
      releaseReadReceipt();
      await expect.poll(() => blockedRequests).toBeGreaterThan(0);
      await expect(peer.getByText("Secure sync is blocked", { exact: true })).toBeVisible();
      await expect(peer.locator("textarea").last()).toBeDisabled();
      await expect(peer.getByText("persisted before reload", { exact: true })).toBeVisible();

      await peer.unroute(transportPattern);
      await peer.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(peer.locator("textarea").last()).toBeEnabled({ timeout: 60_000 });
      await expect(peer.getByText("Secure sync is blocked", { exact: true })).toHaveCount(0);
      await sendText(peer, "sent after secure recovery");
      await expect(peer.getByText("sent after secure recovery", { exact: true })).toBeVisible();
    } finally {
      releaseReadReceipt();
      await peer.unroute(readPattern);
      await peer.unroute(transportPattern);
    }

    await verifyActiveComposition(owner, peer, sendText, openConversation);
  } finally {
    // Close both browser contexts concurrently. On cold CI runners the MLS
    // scenario can legitimately consume most of the test budget; serial
    // teardown must not turn a fully-passed scenario into an outer-timeout
    // failure.
    await Promise.allSettled([
      ownerContext.close(),
      peerContext.close(),
    ]);
  }
});

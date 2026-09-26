import { expect, test, type Page } from "@playwright/test";
import { ensureSudokuGame } from "./support/sudoku-start";
import { acceptedMessage } from "./support/accepted-message";
import { observeRealtimeSocket, verifyActiveComposition } from "./support/active-composition";
import type { Conversation } from "../../features/messenger/types";

const testPhone = (index: number) => "+" + String(70000000000 + index);
const OWNER_PHONE = testPhone(1);
const PEER_PHONE = testPhone(2);
const PASSWORD = "browser acceptance password";

type ObservedWindow = Window & { __sudokuE2eRealtimeSocket?: WebSocket };

async function unlockPrivate(page: Page) {
  await page.goto("/");
  await ensureSudokuGame(page);
  const five = page.getByRole("button", { name: "5", exact: true });
  await expect(five).toBeVisible();

  // Dispatch the real release-driven gesture. The drag tracks the finger;
  // only pointer release commits the reveal from distance/velocity.
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
  await five.dispatchEvent("pointerup", {
    clientX: startX + 1,
    clientY: startY * 0.45,
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    buttons: 0,
  });

  await expect(page.locator(".messenger-lock, .messenger-page").first()).toBeVisible();
  await expect(page.locator(".private-reveal-layer")).not.toHaveAttribute("inert", "", {
    timeout: 5_000,
  });
}

async function login(page: Page, phone: string) {
  await unlockPrivate(page);
  const phoneInput = page.getByLabel("Phone number", { exact: true });

  await expect(phoneInput).toBeVisible({ timeout: 30_000 });
  await phoneInput.fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);

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

  await expect(page.getByText("Use PIN for quick sign-in on this device?", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Not now", exact: true }).click();

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
    await observeRealtimeSocket(owner);
    // Peer must publish a KeyPackage before the owner bootstraps the direct chat.
    await login(peer, PEER_PHONE);
    await login(owner, OWNER_PHONE);

    let directoryRequests = 0;
    owner.on("request", (request) => {
      if (request.url().includes("/v1/users?q=")) directoryRequests += 1;
    });

    await owner.getByRole("button", { name: "New secure chat" }).click();
    await expect(owner.getByRole("dialog", { name: "Create secure chat" })).toBeVisible();
    await expect(owner.getByRole("button", { name: "Direct", exact: true })).toHaveAttribute("aria-pressed", "true");

    await expect.poll(() => directoryRequests).toBeGreaterThan(0);

    const peopleSearch = owner.getByPlaceholder("Search people");
    await peopleSearch.fill("Browser Peer");
    const peerResult = owner.locator(".directory-item").filter({ hasText: PEER_PHONE });
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
    await expect(acceptedMessage(owner, "persisted before reload")).toBeVisible();

    // UX3 must preserve actual encrypted history and drafts, not only fixture UI.
    await expect(owner.locator(".message-date-separator")).toHaveCount(1);
    await composer.fill("unsent secure draft");
    await owner.getByRole("button", { name: "Back to conversations" }).click();
    await openConversation(owner, "Browser Peer");
    await expect(composer).toHaveValue("unsent secure draft");
    await owner.getByRole("button", { name: "Encrypted message actions" }).last().click();
    await expect(owner.getByRole("dialog", { name: "Message actions", exact: true })).toBeVisible();
    await owner.keyboard.press("Escape");
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await composer.fill("");

    // Do not depend on realtime: reload must recover the assigned Welcome and
    // persisted OpenMLS/IndexedDB state by itself.
    await reopenMessenger(peer);
    await openConversation(peer, "Browser Owner");
    await expect(acceptedMessage(peer, "persisted before reload")).toBeVisible({
      timeout: 60_000,
    });

    // A second reload proves the joined group/provider state is persisted,
    // rather than reconstructed from a one-off Welcome.
    await reopenMessenger(peer);
    await openConversation(peer, "Browser Owner");
    await expect(acceptedMessage(peer, "persisted before reload")).toBeVisible();
    await expect(peer.locator(".message-date-separator")).toHaveCount(1);

    // Offline application sends must be encrypted + persisted locally and
    // delivered with the same client id/ciphertext after reconnect.
    await ownerContext.setOffline(true);
    await sendText(owner, "queued while offline");
    const offlineQueued = owner.locator(".message-bubble.pending").filter({
      hasText: "queued while offline",
    });
    await expect(offlineQueued.getByText("Queued", { exact: true })).toBeVisible();
    await ownerContext.setOffline(false);

    await expect(acceptedMessage(owner, "queued while offline")).toBeVisible({
      timeout: 60_000,
    });

    // Recipient catches up without relying on push/realtime.
    await peer.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(acceptedMessage(peer, "queued while offline")).toBeVisible({
      timeout: 60_000,
    });

    // A transient online failure must retry automatically after backoff using
    // the already persisted ciphertext/client id. There must be one accepted
    // visible message even though the first POST never reaches the server.
    const messagePattern = "**/v1/conversations/**/messages";
    let automaticRetryPosts = 0;
    await owner.route(messagePattern, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      automaticRetryPosts += 1;
      if (automaticRetryPosts === 1) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    await sendText(owner, "automatic retry state");
    const autoRetryQueued = owner.locator(".message-bubble.pending").filter({
      hasText: "automatic retry state",
    });
    await expect(autoRetryQueued.getByText("Retrying…", { exact: true })).toBeVisible();
    await expect(acceptedMessage(owner, "automatic retry state")).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(() => automaticRetryPosts).toBe(2);
    await expect(acceptedMessage(owner, "automatic retry state")).toHaveCount(1);
    await owner.unroute(messagePattern);

    await peer.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(acceptedMessage(peer, "automatic retry state")).toBeVisible({
      timeout: 60_000,
    });
    await expect(acceptedMessage(peer, "automatic retry state")).toHaveCount(1);

    // A permanent 422 must remain Failed without automatic retry. Manual Retry
    // still reuses the durable client id/ciphertext once the server accepts it.
    let permanentPosts = 0;
    await owner.route(messagePattern, async (route) => {
      if (route.request().method() === "POST") {
        permanentPosts += 1;
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Permanent test rejection" }),
        });
        return;
      }
      await route.continue();
    });

    await sendText(owner, "manual retry state");
    const failedQueued = owner.locator(".message-bubble.pending").filter({
      hasText: "manual retry state",
    });
    await expect(failedQueued.getByText("Failed", { exact: true })).toBeVisible();
    await expect(failedQueued.getByRole("button", { name: "Retry failed message" })).toBeVisible();

    // A later message can queue behind the permanent head. Its send attempt
    // fails while flushing the head, so only the blocking head is Failed.
    await sendText(owner, "queued behind permanent failure");
    const queuedBehindFailure = owner.locator(".message-bubble.pending").filter({
      hasText: "queued behind permanent failure",
    });
    await expect(queuedBehindFailure.getByText("Queued", { exact: true })).toBeVisible();
    await expect(failedQueued.getByText("Failed", { exact: true })).toBeVisible();
    await owner.waitForTimeout(1_300);
    expect(permanentPosts).toBe(2);

    await owner.unroute(messagePattern);
    await failedQueued.getByRole("button", { name: "Retry failed message" }).click();
    await expect(acceptedMessage(owner, "manual retry state")).toBeVisible({
      timeout: 60_000,
    });
    await expect(acceptedMessage(owner, "queued behind permanent failure")).toBeVisible({
      timeout: 60_000,
    });
    await expect(acceptedMessage(owner, "manual retry state")).toHaveCount(1);
    await expect(acceptedMessage(owner, "queued behind permanent failure")).toHaveCount(1);

    await peer.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(acceptedMessage(peer, "manual retry state")).toBeVisible({
      timeout: 60_000,
    });
    await expect(acceptedMessage(peer, "queued behind permanent failure")).toBeVisible({
      timeout: 60_000,
    });
    await expect(acceptedMessage(peer, "manual retry state")).toHaveCount(1);
    await expect(acceptedMessage(peer, "queued behind permanent failure")).toHaveCount(1);

    // Removing an offline queued text must not send it later and must not break
    // the MLS generation chain for a subsequent encrypted message.
    await ownerContext.setOffline(true);
    await sendText(owner, "removed queued message");
    const removableQueued = owner.locator(".message-bubble.pending").filter({
      hasText: "removed queued message",
    });
    await expect(removableQueued.getByText("Queued", { exact: true })).toBeVisible();
    await removableQueued.getByRole("button", { name: "Remove queued message" }).click();
    await expect(removableQueued).toHaveCount(0);
    await ownerContext.setOffline(false);

    await expect(acceptedMessage(owner, "removed queued message")).toHaveCount(0);
    await sendText(owner, "sent after removed queue");
    await expect(acceptedMessage(owner, "sent after removed queue")).toBeVisible({
      timeout: 60_000,
    });

    await peer.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(acceptedMessage(peer, "sent after removed queue")).toBeVisible({
      timeout: 60_000,
    });
    await expect(acceptedMessage(peer, "removed queued message")).toHaveCount(0);

    // Read receipts now follow visible history and are deduplicated. Hold a
    // successful transport response itself to exercise the same queued-refresh
    // race, rather than expecting another receipt for an unchanged watermark.
    const transportPattern = "**/v1/e2ee/conversations/**/transport-events**";
    let releaseTransport!: () => void;
    const transportGate = new Promise<void>((resolve) => { releaseTransport = resolve; });
    let firstTransport = true;
    let transportHeld = false;
    let blockedRequests = 0;
    await peer.route(transportPattern, async (route) => {
      if (firstTransport) {
        firstTransport = false;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        transportHeld = true;
        await transportGate;
        await route.fulfill({ response });
      } else {
        blockedRequests += 1;
        await route.abort();
      }
    });

    try {
      await peer.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect.poll(() => transportHeld).toBe(true);
      await expect(peer.locator("textarea").last()).toBeEnabled();
      // A second notification must not be lost while the first sync is held.
      await peer.evaluate(() => window.dispatchEvent(new Event("online")));
      releaseTransport();
      await expect.poll(() => blockedRequests).toBeGreaterThan(0);
      await expect(peer.getByText("Secure sync is blocked", { exact: true })).toBeVisible();
      await expect(peer.locator("textarea").last()).toBeDisabled();
      await expect(acceptedMessage(peer, "persisted before reload")).toBeVisible();

      await peer.unroute(transportPattern);
      await peer.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(peer.locator("textarea").last()).toBeEnabled({ timeout: 60_000 });
      await expect(peer.getByText("Secure sync is blocked", { exact: true })).toHaveCount(0);
      await sendText(peer, "sent after secure recovery");
      await expect(acceptedMessage(peer, "sent after secure recovery")).toBeVisible();
    } finally {
      releaseTransport();
      await peer.unroute(transportPattern);
    }

    await verifyActiveComposition(owner, peer, sendText, openConversation, unlockPrivate);
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




test("BFCache lifecycle preserves the active MLS adapter", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, testPhone(5));

  const newChat = page.getByRole("button", { name: "New secure chat" });
  await expect(newChat).toBeEnabled();

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });

  await expect(page.getByText("Messages", { exact: true })).toBeVisible();
  await expect(newChat).toBeEnabled({ timeout: 30_000 });
  await expect(
    page.getByText("Secure messaging needs a restart.", { exact: true }),
  ).toHaveCount(0);
});

test("fresh authenticated device joins an existing encrypted direct chat without Reload", async ({ browser }) => {
  test.setTimeout(360_000);
  const ownerContext = await browser.newContext();
  const peerContext = await browser.newContext();
  const freshContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const peer = await peerContext.newPage();
  const freshOwner = await freshContext.newPage();

  try {
    await observeRealtimeSocket(owner);
    await observeRealtimeSocket(peer);
    await observeRealtimeSocket(freshOwner);

    await login(peer, PEER_PHONE);
    await login(owner, OWNER_PHONE);

    let response = await owner.request.get("/v1/conversations");
    expect(response.ok()).toBe(true);
    let items = await response.json() as Conversation[];
    let direct = items.find((item) =>
      item.type === "direct"
      && item.members.some((member) => member.email === "browser-peer@example.com")
    );

    if (!direct) {
      await owner.getByRole("button", { name: "New secure chat" }).click();
      await expect(owner.getByRole("dialog", { name: "Create secure chat" })).toBeVisible();
      const peopleSearch = owner.getByPlaceholder("Search people");
      await peopleSearch.fill("Browser Peer");
      const peerResult = owner.locator(".directory-item").filter({ hasText: PEER_PHONE });
      await expect(peerResult).toBeVisible();
      await peerResult.click();
      await expect(owner.getByText("End-to-end encrypted", { exact: true })).toBeVisible({
        timeout: 60_000,
      });
      response = await owner.request.get("/v1/conversations");
      expect(response.ok()).toBe(true);
      items = await response.json() as Conversation[];
      direct = items.find((item) =>
        item.type === "direct"
        && item.members.some((member) => member.email === "browser-peer@example.com")
      );
    }

    expect(direct).toBeDefined();
    if (!direct) throw new Error("Existing encrypted direct conversation is missing");

    await login(freshOwner, OWNER_PHONE);
    await expect(
      freshOwner.getByText("Secure messaging needs a restart.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      freshOwner.getByText(
        "Preparing secure messaging on this device. Existing secure chats will become available automatically.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 60_000 });

    const pendingResponse = await owner.request.get(
      `/v1/e2ee/conversations/${direct.id}/membership-changes/pending`,
    );
    expect(pendingResponse.ok()).toBe(true);
    const pending = await pendingResponse.json() as {
      change: { kind?: string; target_device_id?: string | null } | null;
    };
    expect(pending.change?.kind).toBe("device_add");
    expect(pending.change?.target_device_id).toBeTruthy();

    await owner.evaluate(({ conversationId }) => {
      const socket = (window as ObservedWindow).__sudokuE2eRealtimeSocket;
      if (!socket) throw new Error("Owner realtime observer is not installed");
      socket.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({
          type: "mls.device.changed",
          conversation_id: conversationId,
          payload: {},
        }),
      }));
    }, { conversationId: direct.id });

    await expect.poll(async () => {
      const pendingResult = await owner.request.get(
        `/v1/e2ee/conversations/${direct!.id}/membership-changes/pending`,
      );
      if (!pendingResult.ok()) return "request-failed";
      const body = await pendingResult.json() as { change: unknown };
      return body.change === null ? "ready" : "pending";
    }, { timeout: 60_000 }).toBe("ready");

    await expect(
      freshOwner.getByText(
        "Preparing secure messaging on this device. Existing secure chats will become available automatically.",
        { exact: true },
      ),
    ).toHaveCount(0, { timeout: 60_000 });

    await openConversation(freshOwner, "Browser Peer");
    await openConversation(peer, "Browser Owner");
    await peer.evaluate(() => window.dispatchEvent(new Event("online")));
    await sendText(peer, "delivered after fresh-device rekey");
    await expect(acceptedMessage(peer, "delivered after fresh-device rekey")).toBeVisible({
      timeout: 60_000,
    });
    await freshOwner.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(acceptedMessage(freshOwner, "delivered after fresh-device rekey")).toBeVisible({
      timeout: 60_000,
    });
  } finally {
    await Promise.allSettled([
      ownerContext.close(),
      peerContext.close(),
      freshContext.close(),
    ]);
  }
});

test("lost local MLS state never suggests Reload for the same authenticated session", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, testPhone(5));

    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("sudoku-private-crypto");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("Unable to delete crypto database"));
        request.onblocked = () => reject(new Error("Crypto database deletion was blocked"));
      });
    });

    await page.reload();
    await unlockPrivate(page);

    await expect(
      page.getByText(
        "This device lost its secure local state. Sign in again to register it as a new secure device.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Sign in again", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload", exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Secure messaging needs a restart.", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

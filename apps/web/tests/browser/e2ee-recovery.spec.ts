import { expect, test, type Page } from "@playwright/test";

const OWNER_EMAIL = "browser-owner@example.com";
const PEER_EMAIL = "browser-peer@example.com";
const PASSWORD = "browser acceptance password";

async function unlockPrivate(page: Page) {
  await page.goto("/");
  const five = page.getByRole("button", { name: "5", exact: true });
  await expect(five).toBeVisible();

  // Dispatch the exact press-and-drag gesture handled by useSecretUnlock.
  await five.dispatchEvent("pointerdown", {
    clientX: 190,
    clientY: 740,
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await five.dispatchEvent("pointermove", {
    clientX: 191,
    clientY: 680,
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await five.dispatchEvent("pointermove", {
    clientX: 192,
    clientY: 620,
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    buttons: 1,
  });
  await five.dispatchEvent("pointerup", {
    clientX: 192,
    clientY: 620,
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
    // Peer must publish a KeyPackage before the owner bootstraps the direct chat.
    await login(peer, PEER_EMAIL);
    await login(owner, OWNER_EMAIL);

    await owner.getByRole("button", { name: "New secure chat" }).click();
    await owner.getByPlaceholder("Search people").fill("Browser Peer");
    const peerResult = owner.locator(".directory-item").filter({ hasText: PEER_EMAIL });
    await expect(peerResult).toBeVisible();
    await peerResult.click();

    await expect(owner.getByText("End-to-end encrypted", { exact: true })).toBeVisible({
      timeout: 60_000,
    });

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

    // When secure transport is unavailable, keep already-decrypted history but
    // fail closed for new authoring until a successful sync.
    await peer.route(
      "**/v1/e2ee/conversations/**/transport-events**",
      (route) => route.abort(),
    );
    await peer.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(peer.getByText("Secure sync is blocked", { exact: true })).toBeVisible();
    await expect(peer.locator("textarea").last()).toBeDisabled();
    await expect(peer.getByText("persisted before reload", { exact: true })).toBeVisible();

    await peer.unroute("**/v1/e2ee/conversations/**/transport-events**");
    await peer.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(peer.locator("textarea").last()).toBeEnabled({ timeout: 60_000 });
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

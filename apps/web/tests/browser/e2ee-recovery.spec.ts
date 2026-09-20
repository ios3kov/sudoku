import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const OWNER_EMAIL = "browser-owner@example.com";
const PEER_EMAIL = "browser-peer@example.com";
const PASSWORD = "browser acceptance password";

async function unlockPrivate(page: Page) {
  await page.goto("/");
  const five = page.getByRole("gridcell", { name: /, 5$/ }).first();
  await expect(five).toBeVisible();
  await five.click();

  const board = page.getByRole("grid", { name: "Sudoku board" });
  await expect(board).toBeVisible();

  // Dispatch the exact pointer events handled by useSecretUnlock instead of
  // relying on OS-level mouse hit-testing/layout timing in headless Chromium.
  await board.dispatchEvent("pointerdown", {
    clientX: 120,
    clientY: 220,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    buttons: 1,
  });
  await board.dispatchEvent("pointerup", {
    clientX: 120,
    clientY: 100,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    buttons: 0,
  });

  await expect(page.locator(".messenger-lock, .messenger-page").first()).toBeVisible();
}

async function login(page: Page, email: string) {
  await unlockPrivate(page);
  const emailInput = page.getByLabel("Email");

  await expect(emailInput).toBeVisible({ timeout: 30_000 });
  await emailInput.fill(email);
  await page.getByLabel("Password").fill(PASSWORD);

  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/v1/auth/login")
      && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  expect((await loginResponse).status()).toBe(200);

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

  const secureHeader = page.getByText("End-to-end encrypted", { exact: true });
  try {
    await expect(secureHeader).toBeVisible({ timeout: 10_000 });
  } catch {
    const diagnostics = await page.evaluate(async () => {
      const [conversationsResponse, sessionsResponse] = await Promise.all([
        fetch("/v1/conversations", { credentials: "include", cache: "no-store" }),
        fetch("/v1/sessions", { credentials: "include", cache: "no-store" }),
      ]);
      const conversations = conversationsResponse.ok
        ? await conversationsResponse.json()
        : [];
      const sessions = sessionsResponse.ok ? await sessionsResponse.json() : [];
      const current = sessions.find((session: { current?: boolean }) => session.current);
      const conversation = conversations[0] ?? null;

      let controlStatus: number | null = null;
      let controlCount: number | null = null;
      let transportStatus: number | null = null;
      let transportKinds: string[] | null = null;
      if (conversation?.id && current?.id) {
        const control = await fetch(
          `/v1/e2ee/conversations/${conversation.id}/devices/${current.id}/control-events`,
          { credentials: "include", cache: "no-store" },
        );
        controlStatus = control.status;
        if (control.ok) controlCount = (await control.json()).length;

        const transport = await fetch(
          `/v1/e2ee/conversations/${conversation.id}/devices/${current.id}/transport-events`,
          { credentials: "include", cache: "no-store" },
        );
        transportStatus = transport.status;
        if (transport.ok) {
          transportKinds = (await transport.json()).map(
            (event: { kind?: string }) => String(event.kind ?? "unknown"),
          );
        }
      }

      const dbRequest = indexedDB.open("sudoku-private-crypto");
      const stateKeys = await new Promise<string[]>((resolve) => {
        dbRequest.onerror = () => resolve([]);
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          if (!db.objectStoreNames.contains("state")) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction("state", "readonly");
          const request = tx.objectStore("state").getAllKeys();
          request.onerror = () => {
            db.close();
            resolve([]);
          };
          request.onsuccess = () => {
            const keys = request.result.map(String);
            db.close();
            resolve(keys);
          };
        };
      });

      return {
        conversationCount: conversations.length,
        conversationId: conversation?.id ?? null,
        e2eeReady: conversation?.e2ee_ready ?? null,
        deviceId: current?.id ?? null,
        controlStatus,
        controlCount,
        transportStatus,
        transportKinds,
        stateKeyCount: stateKeys.length,
        bodyText: document.body.innerText.slice(0, 1200),
      };
    });
    console.log("E2EE_RECOVERY_DIAGNOSTICS", JSON.stringify(diagnostics));
  }

  await expect(secureHeader).toBeVisible({ timeout: 60_000 });
}

async function sendText(page: Page, value: string) {
  const composer = page.locator("textarea").last();
  await expect(composer).toBeEnabled();
  await composer.fill(value);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test("MLS survives reload, offline retry and fails closed on transport outage", async ({ browser }) => {
  test.setTimeout(240_000);
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
    await ownerContext.close();
    await peerContext.close();
  }
});

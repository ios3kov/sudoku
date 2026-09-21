import { expect, type Page } from "@playwright/test";
import type { Conversation } from "../../../features/messenger/types";

type ObservedWindow = Window & { __sudokuE2eRealtimeSocket?: WebSocket };

/** Test-only observer; native networking and application handlers stay intact. */
export async function observeRealtimeSocket(page: Page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (new URL(String(url), window.location.href).pathname === "/v1/ws") {
          (window as ObservedWindow).__sudokuE2eRealtimeSocket = this;
        }
      }
    };
  });
}

export async function verifyActiveComposition(
  owner: Page,
  peer: Page,
  sendText: (page: Page, value: string) => Promise<void>,
  openConversation: (page: Page, peerName: string) => Promise<void>,
) {
  const composer = peer.locator("textarea").last();
  let lastSequence = 0;

  async function receiveWhileWriting(label: string, draft: string) {
    await composer.fill(draft);
    await sendText(owner, label);
    await expect(owner.getByText(label, { exact: true })).toBeVisible();
    const response = await peer.request.get("/v1/conversations");
    expect(response.ok()).toBe(true);
    const conversations = await response.json() as Conversation[];
    const conversation = conversations.find((item) => item.type === "direct"
      && item.members.some((member) => member.email === "browser-owner@example.com"));
    expect(conversation).toBeDefined();
    if (!conversation) throw new Error("Acceptance conversation is missing");
    expect(conversation.latest_sequence).toBeGreaterThan(lastSequence);
    lastSequence = conversation.latest_sequence;

    // The CI stack does not run the outbox worker. Deliver the API-backed
    // notification through the real client handler, not an `online` event:
    // only message.created updates the parent's latest_sequence prop.
    await peer.evaluate(({ id, sequence }) => {
      const socket = (window as ObservedWindow).__sudokuE2eRealtimeSocket;
      if (!socket) throw new Error("Realtime observer is not installed");
      socket.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ type: "message.created", conversation_id: id, payload: { sequence } }),
      }));
    }, { id: conversation.id, sequence: conversation.latest_sequence });
    await expect(peer.getByText(label, { exact: true })).toBeVisible();
    await expect(composer).toHaveValue(draft);
  }

  await receiveWhileWriting("incoming during draft", "unsent private draft");

  await peer.locator(".message-row").filter({ hasText: "persisted before reload" })
    .getByRole("button", { name: "Encrypted message actions", exact: true }).click();
  await peer.getByRole("button", { name: "Reply", exact: true }).click();
  await receiveWhileWriting("incoming during reply", "unsent private reply");
  await expect(peer.getByRole("button", { name: "Cancel reply", exact: true })).toBeVisible();
  await peer.getByRole("button", { name: "Cancel reply", exact: true }).click();

  await peer.locator(".message-row.own").filter({ hasText: "sent after secure recovery" })
    .getByRole("button", { name: "Encrypted message actions", exact: true }).click();
  await peer.getByRole("button", { name: "Edit", exact: true }).click();
  await receiveWhileWriting("incoming during edit", "unsaved private edit");
  await expect(peer.getByText("Editing encrypted message", { exact: true })).toBeVisible();
  await peer.getByRole("button", { name: "Cancel edit", exact: true }).click();
  await expect(composer).toHaveValue("");

  // Active drafts are memory-only. Leaving the view must still clear them.
  await composer.fill("discard on leaving this chat");
  const back = peer.getByRole("button", { name: "Back to conversations", exact: true });
  await expect(back).toBeVisible();
  await back.click({ timeout: 5_000 });
  await openConversation(peer, "Browser Owner");
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue("");
  await expect(peer.getByRole("button", { name: "Cancel reply", exact: true })).toHaveCount(0);
  await expect(peer.getByRole("button", { name: "Cancel edit", exact: true })).toHaveCount(0);
  await composer.fill("discard when hidden");
  await peer.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(peer.locator(".conversation-view")).toHaveCount(0);
  await expect(peer.locator(".sudoku-reveal-screen")).toBeVisible();
}

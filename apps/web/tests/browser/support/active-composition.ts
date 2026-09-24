import { expect, type Page } from "@playwright/test";
import { acceptedMessage } from "./accepted-message";
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
  unlockPrivate: (page: Page) => Promise<void>,
) {
  const composer = peer.locator("textarea").last();
  let lastSequence = 0;

  async function receiveWhileWriting(label: string, draft: string) {
    await composer.fill(draft);

    // This helper verifies active-composition preservation, not the separate
    // "reading older history" behavior. Opening actions on an old message can
    // legitimately move the timeline away from the tail, especially as this
    // acceptance conversation grows. Pin to latest without clearing the draft,
    // reply or edit context before injecting the next incoming message.
    const jumpToLatest = peer.locator(".jump-to-latest");
    if (await jumpToLatest.isVisible()) {
      await jumpToLatest.click();
      await expect(composer).toHaveValue(draft);
    }

    await sendText(owner, label);
    await expect(acceptedMessage(owner, label)).toBeVisible();
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
    await expect(acceptedMessage(peer, label)).toBeVisible();
    await expect(composer).toHaveValue(draft);
  }

  await receiveWhileWriting("incoming during draft", "unsent private draft");

  // Deliver a real server-confirmed receipt through the native client handler;
  // the encrypted view must update Sent -> Read without leaving the chat.
  const receiptResponse = await peer.request.get("/v1/conversations");
  expect(receiptResponse.ok()).toBe(true);
  const receiptConversations = await receiptResponse.json() as Conversation[];
  const current = receiptConversations.find((item) => item.type === "direct"
    && item.members.some((member) => member.email === "browser-owner@example.com"));
  expect(current).toBeDefined();
  if (!current) throw new Error("Receipt conversation is missing");
  const reader = current.members.find((member) => member.email === "browser-peer@example.com");
  expect(reader).toBeDefined();
  if (!reader) throw new Error("Receipt reader is missing");
  await expect.poll(async () => {
    const response = await peer.request.get("/v1/conversations");
    const items = await response.json() as Conversation[];
    return items.find((item) => item.id === current.id)?.last_read_sequence ?? 0;
  }).toBeGreaterThanOrEqual(current.latest_sequence);
  await owner.evaluate(({ id, userId, sequence }) => {
    const socket = (window as ObservedWindow).__sudokuE2eRealtimeSocket;
    if (!socket) throw new Error("Owner realtime observer is not installed");
    socket.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ type: "receipt.updated", conversation_id: id,
        payload: { user_id: userId, last_read_sequence: sequence } }),
    }));
  }, { id: current.id, userId: reader.id, sequence: current.latest_sequence });
  await expect(owner.locator(".message-row.own").filter({ hasText: "incoming during draft" })
    .locator(".message-delivery")).toContainText("Read");

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
  await expect(composer).toHaveValue("unsent private reply");

  // Drafts now survive chat navigation, but remain in private-surface RAM only.
  await composer.fill("retain while switching chats");
  const back = peer.getByRole("button", { name: "Back to conversations", exact: true });
  await expect(back).toBeVisible();
  await back.click({ timeout: 5_000 });
  await openConversation(peer, "Browser Owner");
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue("retain while switching chats");
  await expect(peer.getByRole("button", { name: "Cancel reply", exact: true })).toHaveCount(0);
  await expect(peer.getByRole("button", { name: "Cancel edit", exact: true })).toHaveCount(0);
  await composer.fill("discard when hidden");
  await peer.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(peer.locator(".conversation-view")).toHaveCount(0);
  await expect(peer.locator(".sudoku-reveal-screen")).toBeVisible();
  await unlockPrivate(peer);
  await openConversation(peer, "Browser Owner");
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue("");
}

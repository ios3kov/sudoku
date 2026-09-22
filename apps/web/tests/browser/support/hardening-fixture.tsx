import { createRoot } from "react-dom/client";
import { EncryptedConversationView } from "../../../features/messenger/encrypted-conversation-view";
import { EncryptedAttachment } from "../../../features/messenger/encrypted-attachment";
import { BrowserProtocolStateStore } from "../../../features/messenger/crypto/browser-state-store";
import { ConversationDraftProvider } from "../../../features/messenger/conversation-drafts";
import type { OpenMlsProtocolAdapter } from "../../../features/messenger/crypto/openmls-adapter";
import type { Conversation } from "../../../features/messenger/types";
import { messengerApi } from "../../../features/messenger/api";
import { controls, deferred, Recorder } from "./hardening-controls";

const user = { id: "owner", email: "owner@example.test", display_name: "Owner", is_admin: false };
const conversation: Conversation = {
  id: "chat-one", type: "direct", title: null, created_by: user.id,
  created_at: "2026-09-22T00:00:00Z", latest_sequence: 0, last_read_sequence: 0,
  is_pinned: false, notifications_muted: false, encryption_required: true, e2ee_ready: true,
  members: [{ ...user, role: "owner", last_read_sequence: 0 }],
};
const adapter = {
  async syncTransport() { if (controls.blocked) throw new Error("outage"); },
  projectConversation: () => ({ messages: [], rejectedEventIds: [], latestSequence: 0 }),
  pendingApplicationCount: () => 0,
  pendingApplicationMessages: () => [],
  async sendMessageDurably(input: unknown) { controls.sends.push(input); },
} as unknown as OpenMlsProtocolAdapter;

Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
  getUserMedia() {
    const gate = deferred<MediaStream>();
    controls.permissions.push(gate);
    return gate.promise;
  },
} });
Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: class {
  private connected = false;
  constructor(private callback: IntersectionObserverCallback) {}
  notify = () => {
    if (this.connected) this.callback([{ isIntersecting: controls.intersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  };
  observe() { this.connected = true; controls.observers.add(this.notify); queueMicrotask(this.notify); }
  disconnect() { this.connected = false; controls.observers.delete(this.notify); }
} });
const originalCreate = URL.createObjectURL.bind(URL);
const originalRevoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (file) => {
  const value = originalCreate(file); controls.createdUrls.push(value); return value;
};
URL.revokeObjectURL = (url) => { controls.revokedUrls.push(url); originalRevoke(url); };
messengerApi.asset = async () => ({ id: controls.metadata.assetId, e2ee_ciphertext: true } as Awaited<ReturnType<typeof messengerApi.asset>>);

const root = createRoot(document.getElementById("root")!);
function hide() { root.render(null); }
function mount(kind: "voice" | "image" | "file" | "audio" = "voice") {
  root.render(kind === "voice" ? (
    <ConversationDraftProvider>
      <EncryptedConversationView
        conversation={conversation} user={user} adapter={adapter} realtimeEvent={null} reconnectTick={0}
        onBack={hide} onHide={hide} onConversationUpdated={() => undefined}
        onReadAcknowledged={() => undefined} onConversationLeft={hide}
      />
    </ConversationDraftProvider>
  ) : <EncryptedAttachment metadata={controls.metadata} messageType={kind === "audio" ? "voice" : kind} />);
}
export const fixture = { controls, mount, hide, BrowserProtocolStateStore };
declare global { interface Window { __hardening: typeof fixture } }
window.__hardening = fixture;

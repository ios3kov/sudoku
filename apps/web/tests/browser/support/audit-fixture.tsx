import type { ProjectedEncryptedMessage } from "@sudoku/domain";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EncryptedAttachment } from "../../../features/messenger/encrypted-attachment";
import { EncryptedConversationView } from "../../../features/messenger/encrypted-conversation-view";
import { ConversationDraftProvider } from "../../../features/messenger/conversation-drafts";
import { messengerApi } from "../../../features/messenger/api";
import type { OpenMlsProtocolAdapter } from "../../../features/messenger/crypto/openmls-adapter";
import type { CurrentUser, Conversation, EncryptedAttachmentMetadata, RealtimeEvent } from "../../../features/messenger/types";
import type { RealtimeClient } from "../../../features/messenger/realtime";
import { io } from "./audit-media-services";

const media = {
  requests: [] as Array<(stream: MediaStream) => void>,
  activeTracks: 0, starts: 0, stops: 0, throwOnConstruct: false, throwOnStart: false,
  recorders: [] as TestRecorder[],
};
class TestRecorder {
  static isTypeSupported() { return true; }
  mimeType = "audio/webm";
  state: RecordingState = "inactive";
  ondataavailable: ((event: {data: Blob}) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { if (media.throwOnConstruct) throw new Error("recorder unavailable"); media.recorders.push(this); }
  start() { if (media.throwOnStart) throw new Error("start failed"); this.state = "recording"; media.starts += 1; }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive"; media.stops += 1;
    queueMicrotask(() => { this.ondataavailable?.({data: new Blob(["test audio"])}); this.onstop?.(); });
  }
  fail() { this.ondataavailable?.({data: new Blob(["partial audio"])}); this.onerror?.(); this.stop(); }
}
Object.defineProperty(navigator, "mediaDevices", {configurable: true, value: {
  getUserMedia: () => new Promise<MediaStream>((resolve) => { media.requests.push(resolve); }),
}});
Object.defineProperty(window, "MediaRecorder", {configurable: true, value: TestRecorder});
const urls = { created: [] as string[], revoked: [] as string[] };
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (file) => { const url = create(file); urls.created.push(url); return url; };
URL.revokeObjectURL = (url) => { urls.revoked.push(url); revoke(url); };
const metadata: EncryptedAttachmentMetadata = {
  version: 1, algorithm: "AES-256-GCM", assetId: "asset", originalName: "test.webm", originalMime: "audio/webm",
  plaintextSize: 10, plaintextSha256Hex: "0".repeat(64), ciphertextSha256Hex: "0".repeat(64), keyB64: "", nonceB64: "",
  voice: { durationMs: 4_200, waveform: [0.2, 0.5, 0.8, 0.4] },
};
const user = {id: "me", display_name: "Test owner", email: "owner@example.test", is_admin: false} as CurrentUser;
const conversation = {
  id: "chat",
  type: "direct",
  title: null,
  latest_sequence: 20,
  last_read_sequence: 20,
  members: [
    { id: "me", display_name: "Test owner", phone_e164: null, email: "owner@example.test", role: "owner", last_read_sequence: 20 },
    { id: "peer", display_name: "Alice", phone_e164: null, email: "peer@example.test", role: "member", last_read_sequence: 20 },
  ],
  encryption_required: true,
  e2ee_ready: true,
} as unknown as Conversation;
const protocol = {
  blocked: false,
  sends: 0,
  lastSend: null as unknown,
  typing: [] as Array<{conversationId: string; active: boolean}>,
  reads: [] as number[],
  messages: [] as ProjectedEncryptedMessage[],
};
const realtime = {
  sendTyping: (conversationId: string, active: boolean) => {
    protocol.typing.push({ conversationId, active });
  },
} as unknown as RealtimeClient;
const adapter = {
  syncTransport: async () => { if (protocol.blocked) throw new Error("transport unavailable"); },
  projectConversation: (): ReturnType<OpenMlsProtocolAdapter["projectConversation"]> => ({
    // Match the real projector: every sync returns a fresh immutable snapshot.
    messages: [...protocol.messages],
    appliedEventIds: protocol.messages.map(message => message.id),
    rejectedEventIds: [],
    latestSequence: protocol.messages.reduce((latest, message) => Math.max(latest, message.sequence), 0),
  }),
  pendingApplicationCount: () => 0,
  pendingApplicationMessages: () => [],
  sendMessageDurably: async (payload: unknown) => {
    protocol.sends += 1;
    protocol.lastSend = payload;
  },
} as unknown as OpenMlsProtocolAdapter;
messengerApi.asset = async () => ({id: "asset", e2ee_ciphertext: true}) as Awaited<ReturnType<typeof messengerApi.asset>>;
messengerApi.markRead = async (_conversationId: string, sequence: number) => {
  protocol.reads.push(sequence);
};
const root = createRoot(document.getElementById("root")!);
let emitRealtime: ((event: RealtimeEvent) => void) | null = null;
function Fixture({kind}: {kind: "voice" | "image" | "file" | "chat"}) {
  const [visible, setVisible] = useState(true);
  const [event, setEvent] = useState<RealtimeEvent | null>(null);
  useEffect(() => {
    emitRealtime = setEvent;
    return () => { emitRealtime = null; };
  }, []);
  return <main>{kind !== "chat" ? <button onClick={() => setVisible(false)}>Unmount private surface</button> : null}<div className={kind === "chat" ? "messenger-page" : ""}><section className={kind === "chat" ? "messenger-shell minimal-messenger-frame messenger-runtime-shell" : ""}>{visible ?
    kind === "chat" ? <ConversationDraftProvider><EncryptedConversationView
      conversation={conversation} user={user} adapter={adapter} realtime={realtime} realtimeEvent={event} reconnectTick={0}
      onBack={() => setVisible(false)} onHide={() => setVisible(false)} onConversationUpdated={() => undefined}
      onReadAcknowledged={() => undefined} onConversationLeft={() => setVisible(false)}
    /></ConversationDraftProvider> : <EncryptedAttachment messageType={kind} metadata={metadata}/>
    : <p>Private surface unmounted</p>}</section></div></main>;
}
window.__predeployAudit = {
  io, media, urls, protocol,
  seedHistory() {
    protocol.messages = Array.from({length: 20}, (_, index) => ({
      id: `seed-${index}`, sequence: index+1, senderId: index % 2 ? "me" : "peer", messageType: "text",
      body: index === 19 ? "ДлинноеСообщение".repeat(24) : `Test message ${index}`, createdAt: "2026-09-22T08:20:00Z",
      replyTo: null, assetIds: [], attachments: [], reactions: [], edited: false, deleted: false,
    }));
  },
  mount(kind) { root.render(<Fixture kind={kind}/>); },
  emitRealtime(event) { emitRealtime?.(event); },
  resolveMedia(index = 0) {
    media.activeTracks += 1;
    let stopped = false;
    media.requests[index]({getTracks: () => [{stop() {if (!stopped) { stopped = true; media.activeTracks -= 1; }}}]} as unknown as MediaStream);
  },
  resolveDownload(index = 0) { io.downloads[index].resolve(new File(["test bytes"], "test.webm", {type: "audio/webm"})); },
  rejectDownload(index = 0) { io.downloads[index].reject(new Error("Network interrupted")); },
};
declare global { interface Window { __predeployAudit: {
  seedHistory: () => void;
  io: typeof io; media: typeof media; urls: typeof urls; protocol: typeof protocol;
  mount: (kind: "voice" | "image" | "file" | "chat") => void;
  emitRealtime: (event: RealtimeEvent) => void;
  resolveMedia: (index?: number) => void; resolveDownload: (index?: number) => void; rejectDownload: (index?: number) => void;
}; } }

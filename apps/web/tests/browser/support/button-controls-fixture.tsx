import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AdminInvite } from "../../../features/messenger/admin-invite";
import { ConversationPreferences } from "../../../features/messenger/conversation-preferences";
import { DeviceSessions } from "../../../features/messenger/device-sessions";
import { GroupSettings } from "../../../features/messenger/group-settings";
import { MessageSearch } from "../../../features/messenger/message-search";
import { NewChat } from "../../../features/messenger/new-chat";
import { SecurityVerification } from "../../../features/messenger/security-verification";
import { ProtectedAttachment } from "../../../features/messenger/protected-attachment";
import { acceptUnlock, accessEpoch } from "../../../features/messenger/device-access";
import { messengerApi } from "../../../features/messenger/api";
import type { OpenMlsProtocolAdapter } from "../../../features/messenger/crypto/openmls-adapter";
import type { AssetSummary, Conversation, CurrentUser, DeviceSession, Message } from "../../../features/messenger/types";

type Mode = "invite" | "preferences" | "sessions" | "search" | "security" | "group" | "new-chat" | "protected";

const calls = {
  invites: [] as Array<string | null>,
  clipboard: [] as string[],
  preferences: [] as unknown[],
  revokedSessions: [] as string[],
  searches: [] as string[],
  selectedMessages: [] as string[],
  verified: [] as string[],
  group: [] as string[],
  created: [] as string[],
  fetches: [] as Array<{path: string; method: string; body: unknown}>,
};

const me: CurrentUser = {
  id: "me",
  display_name: "Audit Owner",
  email: "owner@example.test",
  is_admin: true,
};

const peer = { id: "peer", display_name: "Peer User", email: "peer@example.test", role: "member" as const };
const candidate = { id: "candidate", display_name: "Candidate User", email: "candidate@example.test" };

const directConversation = {
  id: "chat",
  type: "direct",
  title: null,
  latest_sequence: 3,
  last_read_sequence: 0,
  is_pinned: false,
  notifications_muted: false,
  encryption_required: false,
  e2ee_ready: false,
  created_by: "me",
  members: [
    { id: "me", display_name: me.display_name, email: me.email, role: "owner" },
    peer,
  ],
} as unknown as Conversation;

const initialGroup = {
  ...directConversation,
  id: "group",
  type: "group",
  title: "Audit Group",
  members: [
    { id: "me", display_name: me.display_name, email: me.email, role: "owner" },
    peer,
  ],
} as unknown as Conversation;
let groupState = initialGroup;

let sessions: DeviceSession[] = [
  {
    id: "current-session",
    device_name: "Current Browser",
    created_at: "2026-09-23T00:00:00Z",
    expires_at: "2026-10-23T00:00:00Z",
    current: true,
  },
  {
    id: "other-session",
    device_name: "Other Device",
    created_at: "2026-09-22T00:00:00Z",
    expires_at: "2026-10-22T00:00:00Z",
    current: false,
  },
];

const legacyAsset = {
  id: "00000000-0000-4000-8000-000000000001",
  filename: "legacy.txt",
  mime_type: "text/plain",
  size_bytes: 10,
  content_url: "/v1/assets/00000000-0000-4000-8000-000000000001/content",
  e2ee_ciphertext: false,
} as unknown as AssetSummary;

const message = {
  id: "message-1",
  conversation_id: "chat",
  sender_id: "peer",
  body: "needle result",
  message_type: "text",
  created_at: "2026-09-23T00:00:00Z",
  sequence: 2,
} as unknown as Message;

const api = messengerApi as unknown as Record<string, (...args: any[]) => Promise<any>>;
api.createInvite = async (email: string | null) => {
  calls.invites.push(email);
  return { token: "invite-token", expires_at: "2026-09-30T00:00:00Z" };
};
api.updateConversationPreferences = async (_id: string, value: unknown) => {
  calls.preferences.push(value);
  return { ...directConversation, ...(value as object) };
};
api.me = async () => me;
api.sessions = async () => sessions;
api.revokeSession = async (id: string) => {
  calls.revokedSessions.push(id);
  sessions = sessions.filter((item) => item.id !== id);
};
api.searchMessages = async (_conversationId: string, query: string) => {
  calls.searches.push(query);
  return [message];
};
api.searchUsers = async (query: string) => {
  calls.searches.push(query);
  return [candidate];
};
api.updateGroup = async (_id: string, title: string) => {
  calls.group.push("rename:" + title);
  groupState = { ...groupState, title };
  return groupState;
};
api.setGroupMemberRole = async (_conversationId: string, userId: string, role: "owner" | "member") => {
  calls.group.push("role:" + userId + ":" + role);
  groupState = {
    ...groupState,
    members: groupState.members.map((member) => member.id === userId ? { ...member, role } : member),
  };
  return groupState;
};
api.removeGroupMember = async (_conversationId: string, userId: string) => {
  calls.group.push("remove:" + userId);
  groupState = { ...groupState, members: groupState.members.filter((member) => member.id !== userId) };
};
api.addGroupMembers = async (_conversationId: string, userIds: string[]) => {
  calls.group.push("add:" + userIds.join(","));
  groupState = {
    ...groupState,
    members: [...groupState.members, { ...candidate, role: "member" }],
  };
  return groupState;
};
api.conversations = async () => [groupState];
api.createDirect = async (userId: string) => {
  calls.created.push("direct:" + userId);
  return { ...directConversation, id: "new-direct", encryption_required: true } as Conversation;
};
api.createGroup = async (title: string, userIds: string[]) => {
  calls.created.push("group:" + title + ":" + userIds.join(","));
  return { ...initialGroup, id: "new-group", title, encryption_required: true } as Conversation;
};

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (value: string) => { calls.clipboard.push(value); } },
});

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  const method = init?.method ?? "GET";
  let body: unknown = null;
  if (typeof init?.body === "string") {
    try { body = JSON.parse(init.body); } catch { body = init.body; }
  }
  calls.fetches.push({ path, method, body });
  if (path === "/v1/auth/device-access" && method === "GET") {
    return Response.json({ pin_enabled: true, password_required: false });
  }
  if (path === "/v1/auth/device-access" && method === "PUT") {
    const remove = (body as {pin?: string | null} | null)?.pin === null;
    return Response.json({ pin_enabled: !remove, unlock_token: remove ? null : "a".repeat(43) });
  }
  if (path === "/v1/assets/00000000-0000-4000-8000-000000000001/download-url") {
    return Response.json({ url: "https://assets.example.test/signed" });
  }
  if (path === "https://assets.example.test/signed") {
    return new Response(new Blob(["legacy-data"], { type: "text/plain" }), { status: 200 });
  }
  return nativeFetch(input, init);
};

const adapter = {
  bootstrapConversation: async (conversation: Conversation) => ({ ...conversation, e2ee_ready: true }),
  peerVerificationDetails: async () => [{
    deviceId: "peer-device-1234",
    safetyNumber: "1111 2222 3333 4444",
    verified: false,
  }],
  markPeerIdentityVerified: async (_userId: string, deviceId: string) => {
    calls.verified.push(deviceId);
  },
} as unknown as OpenMlsProtocolAdapter;

function Frame({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return <main><button type="button" onClick={onClose}>Fixture close</button>{children}</main>;
}

function InviteFixture() {
  const [open, setOpen] = useState(true);
  return <Frame onClose={() => setOpen(false)}>{open ? <AdminInvite onClose={() => setOpen(false)} /> : <p>invite closed</p>}</Frame>;
}

function PreferencesFixture() {
  const [conversation, setConversation] = useState(directConversation);
  const [open, setOpen] = useState(true);
  return <Frame onClose={() => setOpen(false)}>{open ? <ConversationPreferences
    conversation={conversation}
    onUpdated={(next) => setConversation(next)}
    onClose={() => setOpen(false)}
  /> : <p>preferences closed</p>}</Frame>;
}

function SessionsFixture() {
  const [open, setOpen] = useState(true);
  const [currentRevoked, setCurrentRevoked] = useState(false);
  return <Frame onClose={() => setOpen(false)}>{open ? <DeviceSessions
    onClose={() => setOpen(false)}
    onCurrentRevoked={() => setCurrentRevoked(true)}
  /> : <p>sessions closed</p>}{currentRevoked ? <p>current revoked</p> : null}</Frame>;
}

function SearchFixture() {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState("");
  return <Frame onClose={() => setOpen(false)}>{open ? <MessageSearch
    conversationId="chat"
    onSelect={(item) => { calls.selectedMessages.push(item.id); setSelected(item.id); }}
    onClose={() => setOpen(false)}
  /> : <p>search closed</p>}{selected ? <p>selected {selected}</p> : null}</Frame>;
}

function SecurityFixture() {
  const [open, setOpen] = useState(true);
  return <Frame onClose={() => setOpen(false)}>{open ? <SecurityVerification
    conversation={directConversation}
    user={me}
    adapter={adapter}
    onClose={() => setOpen(false)}
  /> : <p>security closed</p>}</Frame>;
}

function GroupFixture() {
  const [conversation, setConversation] = useState(groupState);
  const [open, setOpen] = useState(true);
  const [left, setLeft] = useState(false);
  return <Frame onClose={() => setOpen(false)}>{open ? <GroupSettings
    conversation={conversation}
    user={me}
    onUpdated={(next) => setConversation(next)}
    onLeft={() => setLeft(true)}
    onClose={() => setOpen(false)}
  /> : <p>group closed</p>}{left ? <p>left group</p> : null}</Frame>;
}

function NewChatFixture() {
  const [open, setOpen] = useState(true);
  const [created, setCreated] = useState("");
  return <Frame onClose={() => setOpen(false)}>{open ? <NewChat
    adapter={adapter}
    onCreated={(conversation) => setCreated(conversation.id)}
    onCancel={() => setOpen(false)}
  /> : <p>new chat closed</p>}{created ? <p>created {created}</p> : null}</Frame>;
}

function ProtectedFixture() {
  acceptUnlock("b".repeat(43), accessEpoch());
  return <main><ProtectedAttachment asset={legacyAsset} voice={false} /></main>;
}

const root = createRoot(document.getElementById("root")!);
function mount(mode: Mode) {
  if (mode === "invite") root.render(<InviteFixture />);
  if (mode === "preferences") root.render(<PreferencesFixture />);
  if (mode === "sessions") root.render(<SessionsFixture />);
  if (mode === "search") root.render(<SearchFixture />);
  if (mode === "security") root.render(<SecurityFixture />);
  if (mode === "group") root.render(<GroupFixture />);
  if (mode === "new-chat") root.render(<NewChatFixture />);
  if (mode === "protected") root.render(<ProtectedFixture />);
}

window.__buttonAudit = { calls, mount };
declare global {
  interface Window {
    __buttonAudit: {
      calls: typeof calls;
      mount: (mode: Mode) => void;
    };
  }
}

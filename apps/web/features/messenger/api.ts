import type { ClaimedPrekeyBundle, Conversation, CreatedInvite, CurrentUser, DeviceSession, E2eeDeviceBundle, E2eeEnvelope, Message } from "./types";

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: "include", cache: "no-store", ...init });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const messengerApi = {
  me: () => request<CurrentUser>("/v1/me"),
  createInvite: (email: string | null) => request<CreatedInvite>("/v1/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, expires_hours: 168, max_uses: 1 }),
  }),
  conversations: () => request<Conversation[]>("/v1/conversations"),
  messages: (conversationId: string, options?: { before?: number; after?: number; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.before !== undefined) params.set("before", String(options.before));
    if (options?.after !== undefined) params.set("after", String(options.after));
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    const qs = params.size ? `?${params.toString()}` : "";
    return request<Message[]>(`/v1/conversations/${conversationId}/messages${qs}`);
  },
  sendMessage: (
    conversationId: string,
    clientId: string,
    body: string | null,
    type: "text" | "image" | "file" | "voice" = "text",
    assetIds: string[] = [],
    replyTo: string | null = null,
  ) => request<Message>(`/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, type, body, reply_to: replyTo, asset_ids: assetIds }),
  }),
  sendEncryptedMessage: (
    conversationId: string,
    clientId: string,
    envelope: E2eeEnvelope,
    type: "text" | "image" | "file" | "voice" = "text",
    assetIds: string[] = [],
    replyTo: string | null = null,
  ) => request<Message>(`/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, type, body: null, envelope, reply_to: replyTo, asset_ids: assetIds }),
  }),
  publishDeviceBundle: (bundle: E2eeDeviceBundle & { one_time_prekeys_b64: string[] }) =>
    request<void>(`/v1/e2ee/devices/${bundle.device_id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bundle),
    }),
  deviceBundles: (userId: string) => request<E2eeDeviceBundle[]>(`/v1/e2ee/users/${userId}/devices`),
  claimPrekey: (userId: string, deviceId: string) =>
    request<ClaimedPrekeyBundle>(`/v1/e2ee/users/${userId}/devices/${deviceId}/prekey/claim`, { method: "POST" }),
  markRead: (conversationId: string, sequence: number) => request<void>(`/v1/conversations/${conversationId}/read`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sequence }),
  }),
  searchUsers: (query: string) => request<Array<{ id: string; display_name: string; email: string }>>(`/v1/users?q=${encodeURIComponent(query)}`),
  createDirect: (userId: string) => request<Conversation>("/v1/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "direct", title: null, member_ids: [userId] }),
  }),
  createGroup: (title: string, userIds: string[]) => request<Conversation>("/v1/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "group", title, member_ids: userIds }),
  }),
  updateConversationPreferences: (conversationId: string, preferences: { is_pinned?: boolean; notifications_muted?: boolean }) => request<Conversation>(`/v1/conversations/${conversationId}/preferences`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(preferences),
  }),
  searchMessages: (conversationId: string, query: string, limit = 30) => request<Message[]>(`/v1/conversations/${conversationId}/search?q=${encodeURIComponent(query)}&limit=${limit}`),
  updateGroup: (conversationId: string, title: string) => request<Conversation>(`/v1/conversations/${conversationId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  }),
  addGroupMembers: (conversationId: string, userIds: string[]) => request<Conversation>(`/v1/conversations/${conversationId}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_ids: userIds }),
  }),
  setGroupMemberRole: (conversationId: string, userId: string, role: "owner" | "member") => request<Conversation>(`/v1/conversations/${conversationId}/members/${userId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  }),
  removeGroupMember: (conversationId: string, userId: string) => request<void>(`/v1/conversations/${conversationId}/members/${userId}`, { method: "DELETE" }),
  sessions: () => request<DeviceSession[]>("/v1/sessions"),
  revokeSession: (sessionId: string) => request<void>(`/v1/sessions/${sessionId}`, { method: "DELETE" }),
  editMessage: (messageId: string, body: string) => request<Message>(`/v1/messages/${messageId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  }),
  deleteMessage: (messageId: string) => request<void>(`/v1/messages/${messageId}`, { method: "DELETE" }),
  toggleReaction: (messageId: string, emoji: string) => request<void>(`/v1/messages/${messageId}/reactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ emoji }),
  }),
};

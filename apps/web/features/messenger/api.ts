import type { AssetSummary, ClaimedMlsKeyPackage, Conversation, CreatedInvite, CurrentUser, DeviceSession, E2eeEnvelope, Message, MlsControlBatchItem, MlsControlBatchResponse, MlsControlEvent, MlsControlRecipient, MlsDeviceAvailability, MlsMembershipChange, MlsTransportEvent, PendingMlsMembershipChange } from "./types";

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
  asset: (assetId: string, signal?: AbortSignal) => request<AssetSummary>(`/v1/assets/${assetId}`, {signal}),
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
  registerMlsDevice: (deviceId: string, identityPublicKeyB64: string) =>
    request<void>(`/v1/e2ee/devices/${deviceId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity_public_key_b64: identityPublicKeyB64 }),
    }),
  revokeMlsDevice: (deviceId: string) =>
    request<void>(`/v1/e2ee/devices/${deviceId}`, { method: "DELETE" }),
  publishMlsKeyPackages: (deviceId: string, keyPackagesB64: string[]) =>
    request<void>(`/v1/e2ee/devices/${deviceId}/key-packages`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, key_packages_b64: keyPackagesB64 }),
    }),
  mlsDevices: (userId: string) =>
    request<MlsDeviceAvailability[]>(`/v1/e2ee/users/${userId}/devices`),
  claimMlsKeyPackage: (userId: string, deviceId: string) =>
    request<ClaimedMlsKeyPackage>(
      `/v1/e2ee/users/${userId}/devices/${deviceId}/key-package/claim`,
      { method: "POST" },
    ),
  discardMlsKeyPackages: (deviceId: string) =>
    request<void>(`/v1/e2ee/devices/${deviceId}/key-packages`, { method: "DELETE" }),
  sendMlsControlEvent: (
    conversationId: string,
    input: {
      client_id: string;
      sender_device_id: string;
      kind: "commit" | "welcome";
      payload_b64: string;
      recipients: MlsControlRecipient[];
    },
  ) =>
    request<MlsControlEvent>(`/v1/e2ee/conversations/${conversationId}/control-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  sendMlsControlBatch: (
    conversationId: string,
    senderDeviceId: string,
    events: MlsControlBatchItem[],
    membershipChangeId: string | null = null,
  ) =>
    request<MlsControlBatchResponse>(
      `/v1/e2ee/conversations/${conversationId}/control-batches`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sender_device_id: senderDeviceId,
          membership_change_id: membershipChangeId,
          events,
        }),
      },
    ),
  mlsTransportEvents: (conversationId: string, deviceId: string, after = 0) =>
    request<MlsTransportEvent[]>(
      `/v1/e2ee/conversations/${conversationId}/devices/${deviceId}/transport-events?after=${after}`,
    ),
  mlsControlEvents: (conversationId: string, deviceId: string, after = 0) =>
    request<MlsControlEvent[]>(
      `/v1/e2ee/conversations/${conversationId}/devices/${deviceId}/control-events?after=${after}`,
    ),
  mlsControlSenderIdentity: (eventId: string) =>
    request<{
      user_id: string;
      device_id: string;
      identity_public_key_b64: string;
    }>(`/v1/e2ee/control-events/${eventId}/sender-identity`),
  ackMlsControlEvent: (eventId: string, deviceId: string) =>
    request<void>(`/v1/e2ee/control-events/${eventId}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_id: deviceId }),
    }),
  activateMlsConversation: (conversationId: string) =>
    request<void>(`/v1/e2ee/conversations/${conversationId}/activate`, {
      method: "POST",
    }),
  prepareMlsMemberAdd: (conversationId: string, userId: string) =>
    request<MlsMembershipChange>(
      `/v1/e2ee/conversations/${conversationId}/membership-changes/add/${userId}`,
      { method: "POST" },
    ),
  prepareMlsMemberRemove: (conversationId: string, userId: string) =>
    request<MlsMembershipChange>(
      `/v1/e2ee/conversations/${conversationId}/membership-changes/remove/${userId}`,
      { method: "POST" },
    ),
  finalizeMlsMembershipChange: (changeId: string) =>
    request<void>(`/v1/e2ee/membership-changes/${changeId}/finalize`, {
      method: "POST",
    }),
  pendingMlsMembershipChange: (conversationId: string) =>
    request<PendingMlsMembershipChange>(
      `/v1/e2ee/conversations/${conversationId}/membership-changes/pending`,
    ),
  markRead: (conversationId: string, sequence: number) => request<void>(`/v1/conversations/${conversationId}/read`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sequence }),
  }),
  searchUsers: (query: string) => request<Array<{ id: string; display_name: string; email: string }>>(`/v1/users?q=${encodeURIComponent(query)}`),
  createDirect: (userId: string, encryptionRequired = false) => request<Conversation>("/v1/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "direct",
      title: null,
      member_ids: [userId],
      encryption_required: encryptionRequired,
    }),
  }),
  createGroup: (title: string, userIds: string[], encryptionRequired = false) => request<Conversation>("/v1/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "group",
      title,
      member_ids: userIds,
      encryption_required: encryptionRequired,
    }),
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

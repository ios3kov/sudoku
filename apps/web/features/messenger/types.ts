export interface CurrentUser {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
}

export interface ConversationMember {
  id: string;
  display_name: string;
  email: string;
  role: string;
  last_read_sequence: number;
}

export interface Conversation {
  id: string;
  type: "direct" | "group";
  title: string | null;
  created_by: string;
  created_at: string;
  last_read_sequence: number;
  latest_sequence: number;
  is_pinned: boolean;
  notifications_muted: boolean;
  encryption_required: boolean;
  members: ConversationMember[];
}

export interface AssetSummary {
  id: string;
  mime_type: string;
  size_bytes: number;
  filename: string;
  status: string;
  content_url: string;
}

export interface ReactionSummary {
  emoji: string;
  user_ids: string[];
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_id: string;
  sequence: number;
  type: "text" | "image" | "file" | "voice";
  body: string | null;
  envelope: E2eeEnvelope | null;
  reply_to: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  assets: AssetSummary[];
  reactions: ReactionSummary[];
}

export interface PendingMessage {
  client_id: string;
  conversation_id: string;
  body: string;
  created_at: number;
  reply_to: string | null;
}

export interface RealtimeEvent {
  event_id?: string;
  type: string;
  conversation_id?: string;
  payload?: unknown;
}

export interface CreatedInvite {
  id: string;
  token: string;
  email: string | null;
  expires_at: string;
  max_uses: number;
}

export interface DeviceSession {
  id: string;
  device_name: string;
  created_at: string;
  expires_at: string;
  current: boolean;
}


export interface E2eeEnvelope {
  version: number;
  protocol: string;
  ciphertext: string;
  [key: string]: unknown;
}

export interface E2eeDeviceBundle {
  device_id: string;
  protocol: string;
  identity_key_b64: string;
  signed_prekey_b64: string;
  signed_prekey_signature_b64: string;
}

export interface ClaimedPrekeyBundle extends E2eeDeviceBundle {
  one_time_prekey: {
    key_id: string;
    public_key_b64: string;
  };
}

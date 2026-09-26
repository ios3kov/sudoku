export interface CurrentUser {
  id: string;
  phone_e164: string | null;
  phone_verified: boolean;
  email: string | null;
  display_name: string;
  profile_setup_completed: boolean;
  is_admin: boolean;
}

export interface ConversationMember {
  id: string;
  display_name: string;
  phone_e164: string | null;
  email: string | null;
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
  e2ee_ready: boolean;
  members: ConversationMember[];
}

export interface AssetSummary {
  id: string;
  mime_type: string;
  size_bytes: number;
  filename: string;
  e2ee_ciphertext: boolean;
  status: string;
  content_url: string;
}


export interface VoiceAttachmentPresentation {
  durationMs: number;
  waveform: number[];
}

export interface EncryptedAttachmentMetadata {
  version: 1;
  algorithm: "AES-256-GCM";
  assetId: string;
  keyB64: string;
  nonceB64: string;
  originalName: string;
  originalMime: string;
  plaintextSize: number;
  plaintextSha256Hex: string;
  ciphertextSha256Hex: string;
  /** Encrypted inside the MLS application event; never plaintext server metadata. */
  voice?: VoiceAttachmentPresentation;
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
  phone_e164: string | null;
  email: string | null;
  expires_at: string;
  max_uses: number;
}

export interface ContactDirectoryItem {
  id: string;
  display_name: string;
  phone_e164: string;
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


export interface MlsDeviceAvailability {
  device_id: string;
  identity_public_key_b64: string;
  available_key_packages: number;
}

export interface ClaimedMlsKeyPackage {
  user_id: string;
  device_id: string;
  identity_public_key_b64: string;
  package_ref: string;
  key_package_b64: string;
}

export interface MlsControlRecipient {
  user_id: string;
  device_id: string;
}

export interface MlsMembershipChange {
  id: string;
  conversation_id: string;
  target_user_id: string;
  target_device_id: string | null;
  requested_by: string;
  kind: "add" | "remove" | "device_add" | "device_remove";
  status: "queued" | "pending" | "completed";
  created_at: string;
  completed_at: string | null;
}

export interface PendingMlsMembershipChange {
  change: MlsMembershipChange | null;
  target_device: {
    device_id: string;
    identity_public_key_b64: string;
    active: boolean;
  } | null;
}

export interface MlsControlEvent {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_device_id: string;
  client_id: string;
  sequence: number;
  kind: "commit" | "welcome";
  membership_change_id?: string | null;
  payload_b64: string;
  created_at: string;
}

export interface MlsControlBatchItem {
  client_id: string;
  kind: "commit" | "welcome";
  payload_b64: string;
  recipients: MlsControlRecipient[];
}

export interface MlsControlBatchResponse {
  events: MlsControlEvent[];
}


export type MlsTransportEvent =
  | {
      transport_sequence: number;
      kind: "message";
      message_id: string;
      sender_user_id: string;
      sender_device_id: string | null;
      message_sequence: number;
      created_at?: string;
      envelope: E2eeEnvelope;
    }
  | {
      transport_sequence: number;
      kind: "mls_control";
      control: MlsControlEvent;
    };

import type { EncryptedEventRecord } from "@sudoku/domain";
import type {
  E2eeEnvelope,
  MlsControlBatchItem,
  MlsControlRecipient,
} from "../types";

export const STATE_VERSION = 1;
export const ENVELOPE_VERSION = 1;
export const PROTOCOL = "mls-rfc9420" as const;

export interface PendingOutboundTransition {
  conversationId: string;
  membershipChangeId: string | null;
  events: MlsControlBatchItem[];
}

export interface PendingApplicationSend {
  conversationId: string;
  clientId: string;
  envelope: E2eeEnvelope;
  event: EncryptedEventRecord["event"];
  serverType: "text" | "image" | "file" | "voice";
  assetIds: string[];
}

export interface PeerIdentityPin {
  userId: string;
  deviceId: string;
  publicKeyB64: string;
  firstSeenAt: number;
  verifiedAt: number | null;
}

export interface LocalMlsStateV1 {
  version: 1;
  providerStateB64: string;
  credentialB64: string;
  publicKeyB64: string;
  pendingAckEventIds: string[];
  pendingOutboundTransition: PendingOutboundTransition | null;
  peerIdentityPins: Record<string, PeerIdentityPin>;
  eventJournal: Record<string, EncryptedEventRecord[]>;
  pendingApplicationSends: PendingApplicationSend[];
  pendingKeyPackagesB64: string[];
  transportCursors: Record<string, number>;
  trackedConversations: string[];
  historyUnavailableConversations: string[];
}

export interface RuntimeSnapshot {
  providerState: Uint8Array;
  localState: LocalMlsStateV1;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function utf8String(value: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

export function makeEnvelope(
  bytes: Uint8Array,
  kind: "application" | "commit" | "welcome",
): E2eeEnvelope {
  return {
    version: ENVELOPE_VERSION,
    protocol: PROTOCOL,
    kind,
    ciphertext: bytesToBase64(bytes),
  };
}

export function envelopeBytes(envelope: E2eeEnvelope): Uint8Array {
  if (envelope.version !== ENVELOPE_VERSION || envelope.protocol !== PROTOCOL) {
    throw new Error("Unsupported E2EE envelope");
  }
  return base64ToBytes(envelope.ciphertext);
}

function isControlRecipient(value: unknown): value is MlsControlRecipient {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MlsControlRecipient>;
  return typeof item.user_id === "string" && typeof item.device_id === "string";
}

function isBatchItem(value: unknown): value is MlsControlBatchItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MlsControlBatchItem>;
  return (
    typeof item.client_id === "string"
    && (item.kind === "commit" || item.kind === "welcome")
    && typeof item.payload_b64 === "string"
    && Array.isArray(item.recipients)
    && item.recipients.every(isControlRecipient)
  );
}

function parsePendingOutbound(value: unknown): PendingOutboundTransition | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object") {
    throw new Error("Invalid pending MLS outbound transition");
  }
  const item = value as Partial<PendingOutboundTransition>;
  if (
    typeof item.conversationId !== "string"
    || !Array.isArray(item.events)
    || item.events.length < 1
    || item.events.some((event) => !isBatchItem(event))
  ) {
    throw new Error("Invalid pending MLS outbound transition");
  }
  return {
    conversationId: item.conversationId,
    membershipChangeId:
      typeof item.membershipChangeId === "string" ? item.membershipChangeId : null,
    events: item.events,
  };
}

function isPendingApplicationSend(value: unknown): value is PendingApplicationSend {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PendingApplicationSend>;
  return (
    typeof item.conversationId === "string"
    && typeof item.clientId === "string"
    && Boolean(item.envelope)
    && typeof item.envelope === "object"
    && Array.isArray(item.assetIds)
    && item.assetIds.every((assetId) => typeof assetId === "string")
    && ["text", "image", "file", "voice"].includes(String(item.serverType))
    && Boolean(item.event)
    && typeof item.event === "object"
  );
}

export function parseLocalState(bytes: Uint8Array): LocalMlsStateV1 {
  const raw = JSON.parse(utf8String(bytes)) as Partial<LocalMlsStateV1>;
  if (
    raw.version !== STATE_VERSION
    || typeof raw.providerStateB64 !== "string"
    || typeof raw.credentialB64 !== "string"
    || typeof raw.publicKeyB64 !== "string"
    || !Array.isArray(raw.pendingAckEventIds)
    || raw.pendingAckEventIds.some((item) => typeof item !== "string")
  ) {
    throw new Error("Invalid local MLS state");
  }
  return {
    version: STATE_VERSION,
    providerStateB64: raw.providerStateB64,
    credentialB64: raw.credentialB64,
    publicKeyB64: raw.publicKeyB64,
    pendingAckEventIds: raw.pendingAckEventIds,
    pendingOutboundTransition: parsePendingOutbound(raw.pendingOutboundTransition),
    peerIdentityPins:
      raw.peerIdentityPins && typeof raw.peerIdentityPins === "object"
        ? raw.peerIdentityPins as Record<string, PeerIdentityPin>
        : {},
    eventJournal:
      raw.eventJournal && typeof raw.eventJournal === "object"
        ? raw.eventJournal as Record<string, EncryptedEventRecord[]>
        : {},
    pendingApplicationSends:
      Array.isArray(raw.pendingApplicationSends)
        ? raw.pendingApplicationSends.filter(isPendingApplicationSend)
        : [],
    pendingKeyPackagesB64:
      Array.isArray(raw.pendingKeyPackagesB64)
        ? raw.pendingKeyPackagesB64.filter((item) => typeof item === "string")
        : [],
    transportCursors:
      raw.transportCursors && typeof raw.transportCursors === "object"
        ? Object.fromEntries(
            Object.entries(raw.transportCursors)
              .filter(([, value]) => Number.isSafeInteger(value) && Number(value) >= 0)
              .map(([key, value]) => [key, Number(value)]),
          )
        : {},
    trackedConversations:
      Array.isArray(raw.trackedConversations)
        ? raw.trackedConversations.filter((item) => typeof item === "string")
        : [],
    historyUnavailableConversations:
      Array.isArray(raw.historyUnavailableConversations)
        ? raw.historyUnavailableConversations.filter((item) => typeof item === "string")
        : [],
  };
}

export function serializeLocalState(state: LocalMlsStateV1): Uint8Array {
  return utf8(JSON.stringify(state));
}

export function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}

export function cloneLocalState(state: LocalMlsStateV1): LocalMlsStateV1 {
  return JSON.parse(JSON.stringify(state)) as LocalMlsStateV1;
}

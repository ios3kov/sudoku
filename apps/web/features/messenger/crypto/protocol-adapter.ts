import type {
  ClaimedMlsKeyPackage,
  E2eeEnvelope,
  EncryptedAttachmentMetadata,
  MlsControlRecipient,
} from "../types";

export interface OutboundPlaintext {
  conversationId: string;
  messageType: "text" | "image" | "file" | "voice";
  body: string | null;
  replyTo: string | null;
  assetIds: string[];
  attachments?: EncryptedAttachmentMetadata[];
}

export interface DecryptedMessage {
  body: string | null;
  metadata?: Record<string, unknown>;
}

export interface MlsMembershipChange {
  commit: E2eeEnvelope;
  welcome?: E2eeEnvelope;
}

export interface ProtocolAdapter {
  readonly protocol: "mls-rfc9420";
  readonly ready: boolean;

  initialize(): Promise<void>;

  createKeyPackages(count: number): Promise<Uint8Array[]>;

  createGroup(conversationId: string): Promise<void>;

  addMemberDurably(
    conversationId: string,
    keyPackage: ClaimedMlsKeyPackage,
    commitRecipients: MlsControlRecipient[],
    welcomeRecipients: MlsControlRecipient[],
  ): Promise<void>;

  removeMemberDurably(
    conversationId: string,
    memberCredential: Uint8Array,
    commitRecipients: MlsControlRecipient[],
  ): Promise<void>;

  syncControlEvents?(conversationId: string): Promise<number>;

  encrypt(input: OutboundPlaintext): Promise<E2eeEnvelope>;

  decrypt(
    conversationId: string,
    envelope: E2eeEnvelope,
  ): Promise<DecryptedMessage>;
}

export class CryptoBackendUnavailableError extends Error {
  constructor() {
    super("A reviewed browser MLS backend is not loaded");
    this.name = "CryptoBackendUnavailableError";
  }
}

async function unavailable(): Promise<never> {
  throw new CryptoBackendUnavailableError();
}

export const unavailableProtocolAdapter: ProtocolAdapter = {
  protocol: "mls-rfc9420",
  ready: false,
  initialize: unavailable,
  createKeyPackages: unavailable,
  createGroup: unavailable,
  addMemberDurably: unavailable,
  removeMemberDurably: unavailable,
  encrypt: unavailable,
  decrypt: unavailable,
};

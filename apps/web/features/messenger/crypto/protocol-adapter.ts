import type { E2eeEnvelope, ClaimedMlsKeyPackage } from "../types";

export interface OutboundPlaintext {
  conversationId: string;
  messageType: "text" | "image" | "file" | "voice";
  body: string | null;
  replyTo: string | null;
  assetIds: string[];
}

export interface DecryptedMessage {
  body: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProtocolAdapter {
  readonly protocol: string;
  readonly ready: boolean;
  initialize(): Promise<void>;
  encrypt(input: OutboundPlaintext, recipients: ClaimedMlsKeyPackage[]): Promise<E2eeEnvelope>;
  decrypt(envelope: E2eeEnvelope): Promise<DecryptedMessage>;
}

export class CryptoBackendUnavailableError extends Error {
  constructor() {
    super("A reviewed browser E2EE backend is not loaded");
    this.name = "CryptoBackendUnavailableError";
  }
}

export const unavailableProtocolAdapter: ProtocolAdapter = {
  protocol: "unavailable",
  ready: false,
  async initialize() {
    throw new CryptoBackendUnavailableError();
  },
  async encrypt() {
    throw new CryptoBackendUnavailableError();
  },
  async decrypt() {
    throw new CryptoBackendUnavailableError();
  },
};

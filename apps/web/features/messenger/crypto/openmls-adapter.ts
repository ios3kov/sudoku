import { messengerApi } from "../api";
import type {
  ClaimedMlsKeyPackage,
  E2eeEnvelope,
  MlsControlEvent,
} from "../types";
import { BrowserProtocolStateStore } from "./browser-state-store";
import { loadOpenMlsWasm } from "./openmls-runtime";
import type {
  DecryptedMessage,
  MlsMembershipChange,
  OutboundPlaintext,
  ProtocolAdapter,
} from "./protocol-adapter";

const STATE_VERSION = 1;
const ENVELOPE_VERSION = 1;
const PROTOCOL = "mls-rfc9420" as const;

interface LocalMlsStateV1 {
  version: 1;
  providerStateB64: string;
  credentialB64: string;
  publicKeyB64: string;
  pendingAckEventIds: string[];
}

export interface OpenMlsAdapterOptions {
  userId: string;
  deviceId: string;
  stateStore?: BrowserProtocolStateStore;
}

type MlsModule = Awaited<ReturnType<typeof loadOpenMlsWasm>>;
type Provider = InstanceType<MlsModule["Provider"]>;
type DeviceIdentity = ReturnType<Provider["createDeviceIdentity"]>;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function utf8String(value: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

function makeEnvelope(bytes: Uint8Array, kind: "application" | "commit" | "welcome"): E2eeEnvelope {
  return {
    version: ENVELOPE_VERSION,
    protocol: PROTOCOL,
    kind,
    ciphertext: bytesToBase64(bytes),
  };
}

function envelopeBytes(envelope: E2eeEnvelope): Uint8Array {
  if (envelope.version !== ENVELOPE_VERSION || envelope.protocol !== PROTOCOL) {
    throw new Error("Unsupported E2EE envelope");
  }
  return base64ToBytes(envelope.ciphertext);
}

function parseLocalState(bytes: Uint8Array): LocalMlsStateV1 {
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
  return raw as LocalMlsStateV1;
}

function serializeLocalState(state: LocalMlsStateV1): Uint8Array {
  return utf8(JSON.stringify(state));
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}

export class OpenMlsProtocolAdapter implements ProtocolAdapter {
  readonly protocol = PROTOCOL;
  private module: MlsModule | null = null;
  private provider: Provider | null = null;
  private identity: DeviceIdentity | null = null;
  private localState: LocalMlsStateV1 | null = null;
  private readonly stateStore: BrowserProtocolStateStore;
  private readonly stateKey: string;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: OpenMlsAdapterOptions) {
    this.stateStore = options.stateStore ?? new BrowserProtocolStateStore();
    this.stateKey = `mls:v1:${options.userId}:${options.deviceId}`;
  }

  get ready(): boolean {
    return Boolean(this.module && this.provider && this.identity && this.localState);
  }

  async initialize(): Promise<void> {
    const module = await loadOpenMlsWasm();
    const stored = await this.stateStore.get(this.stateKey);

    let provider: Provider;
    let identity: DeviceIdentity;
    let state: LocalMlsStateV1;

    if (stored) {
      state = parseLocalState(stored);
      provider = module.Provider.fromState(base64ToBytes(state.providerStateB64));
      identity = module.DeviceIdentity.fromPublic(
        base64ToBytes(state.credentialB64),
        base64ToBytes(state.publicKeyB64),
      );
    } else {
      provider = new module.Provider();
      const credential = utf8(`sudoku-v1:${this.options.userId}:${this.options.deviceId}`);
      identity = provider.createDeviceIdentity(credential);
      state = {
        version: STATE_VERSION,
        providerStateB64: bytesToBase64(provider.exportState()),
        credentialB64: bytesToBase64(identity.credentialBytes()),
        publicKeyB64: bytesToBase64(identity.publicKeyBytes()),
        pendingAckEventIds: [],
      };
      await this.stateStore.put(this.stateKey, serializeLocalState(state));
    }

    this.module = module;
    this.provider = provider;
    this.identity = identity;
    this.localState = state;

    await messengerApi.registerMlsDevice(
      this.options.deviceId,
      bytesToBase64(identity.publicKeyBytes()),
    );
    await this.flushPendingAcks();
  }

  async createKeyPackages(count: number): Promise<Uint8Array[]> {
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new Error("KeyPackage count must be between 1 and 100");
    }
    return this.mutate(async (provider, identity) => {
      const output: Uint8Array[] = [];
      for (let index = 0; index < count; index += 1) {
        output.push(provider.createKeyPackage(identity));
      }
      return output;
    });
  }

  async createAndPublishKeyPackages(count: number): Promise<void> {
    const packages = await this.createKeyPackages(count);
    await messengerApi.publishMlsKeyPackages(
      this.options.deviceId,
      packages.map(bytesToBase64),
    );
  }

  async createGroup(conversationId: string): Promise<void> {
    await this.mutate((provider, identity) => {
      provider.createGroup(identity, utf8(conversationId));
    });
  }

  async addMember(
    conversationId: string,
    keyPackage: ClaimedMlsKeyPackage,
  ): Promise<MlsMembershipChange> {
    return this.mutate((provider, identity) => {
      const change = provider.addMember(
        identity,
        utf8(conversationId),
        base64ToBytes(keyPackage.key_package_b64),
      );
      return {
        commit: makeEnvelope(change.commitBytes(), "commit"),
        welcome: makeEnvelope(change.welcomeBytes(), "welcome"),
      };
    });
  }

  async joinGroup(conversationId: string, welcome: E2eeEnvelope): Promise<void> {
    await this.mutate((provider) => {
      const joined = utf8String(provider.joinGroup(envelopeBytes(welcome)));
      if (joined !== conversationId) {
        throw new Error("MLS Welcome group id does not match conversation");
      }
    });
  }

  async processHandshake(conversationId: string, message: E2eeEnvelope): Promise<void> {
    await this.mutate((provider) => {
      provider.processHandshake(utf8(conversationId), envelopeBytes(message));
    });
  }

  async encrypt(input: OutboundPlaintext): Promise<E2eeEnvelope> {
    return this.mutate((provider, identity) => {
      const payload = utf8(JSON.stringify({
        v: 1,
        type: input.messageType,
        body: input.body,
        replyTo: input.replyTo,
        assetIds: input.assetIds,
      }));
      return makeEnvelope(
        provider.encryptApplication(identity, utf8(input.conversationId), payload),
        "application",
      );
    });
  }

  async decrypt(
    conversationId: string,
    envelope: E2eeEnvelope,
  ): Promise<DecryptedMessage> {
    return this.mutate((provider) => {
      const plaintext = provider.decryptApplication(
        utf8(conversationId),
        envelopeBytes(envelope),
      );
      const parsed = JSON.parse(utf8String(plaintext)) as {
        v?: number;
        body?: unknown;
        type?: unknown;
        replyTo?: unknown;
        assetIds?: unknown;
      };
      if (
        parsed.v !== 1
        || (parsed.body !== null && typeof parsed.body !== "string")
        || typeof parsed.type !== "string"
        || (parsed.replyTo !== null && typeof parsed.replyTo !== "string")
        || !Array.isArray(parsed.assetIds)
        || parsed.assetIds.some((item) => typeof item !== "string")
      ) {
        throw new Error("Invalid decrypted application payload");
      }
      return {
        body: parsed.body,
        metadata: {
          type: parsed.type,
          replyTo: parsed.replyTo,
          assetIds: parsed.assetIds,
        },
      };
    });
  }

  async syncControlEvents(conversationId: string): Promise<number> {
    return this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingAcks();
      const events = await messengerApi.mlsControlEvents(
        conversationId,
        this.options.deviceId,
        0,
      );
      let processed = 0;

      for (const event of events) {
        if (event.kind === "welcome") {
          const joined = utf8String(
            this.provider!.joinGroup(base64ToBytes(event.payload_b64)),
          );
          if (joined !== conversationId) {
            throw new Error("MLS Welcome group id does not match conversation");
          }
        } else if (event.kind === "commit") {
          this.provider!.processHandshake(
            utf8(conversationId),
            base64ToBytes(event.payload_b64),
          );
        } else {
          throw new Error("Unsupported MLS control event");
        }

        this.localState!.pendingAckEventIds = uniqueIds([
          ...this.localState!.pendingAckEventIds,
          event.id,
        ]);
        await this.persistCurrentState();
        await this.ackAndForget(event);
        processed += 1;
      }

      return processed;
    });
  }

  async sendControlEvent(
    conversationId: string,
    kind: "commit" | "welcome",
    bytes: Uint8Array,
    recipients: Array<{ user_id: string; device_id: string }>,
    clientId: string,
  ): Promise<MlsControlEvent> {
    return messengerApi.sendMlsControlEvent(conversationId, {
      client_id: clientId,
      sender_device_id: this.options.deviceId,
      kind,
      payload_b64: bytesToBase64(bytes),
      recipients,
    });
  }

  private async mutate<T>(
    operation: (provider: Provider, identity: DeviceIdentity) => T | Promise<T>,
  ): Promise<T> {
    return this.enqueue(async () => {
      this.assertReady();
      const result = await operation(this.provider!, this.identity!);
      await this.persistCurrentState();
      return result;
    });
  }

  private async persistCurrentState(): Promise<void> {
    this.assertReady();
    this.localState!.providerStateB64 = bytesToBase64(this.provider!.exportState());
    await this.stateStore.put(this.stateKey, serializeLocalState(this.localState!));
  }

  private async flushPendingAcks(): Promise<void> {
    this.assertReady();
    for (const eventId of [...this.localState!.pendingAckEventIds]) {
      await messengerApi.ackMlsControlEvent(eventId, this.options.deviceId);
      this.localState!.pendingAckEventIds =
        this.localState!.pendingAckEventIds.filter((item) => item !== eventId);
      await this.persistCurrentState();
    }
  }

  private async ackAndForget(event: MlsControlEvent): Promise<void> {
    await messengerApi.ackMlsControlEvent(event.id, this.options.deviceId);
    this.localState!.pendingAckEventIds =
      this.localState!.pendingAckEventIds.filter((item) => item !== event.id);
    await this.persistCurrentState();
  }

  private assertReady(): void {
    if (!this.ready) {
      throw new Error("OpenMLS adapter is not initialized");
    }
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release: () => void = () => undefined;
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

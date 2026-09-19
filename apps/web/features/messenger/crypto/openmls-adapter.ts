import { messengerApi } from "../api";
import type {
  ClaimedMlsKeyPackage,
  E2eeEnvelope,
  MlsControlBatchItem,
  MlsControlEvent,
  MlsControlRecipient,
} from "../types";
import { BrowserProtocolStateStore } from "./browser-state-store";
import { loadOpenMlsWasm } from "./openmls-runtime";
import type {
  DecryptedMessage,
  OutboundPlaintext,
  ProtocolAdapter,
} from "./protocol-adapter";

const STATE_VERSION = 1;
const ENVELOPE_VERSION = 1;
const PROTOCOL = "mls-rfc9420" as const;

interface PendingOutboundTransition {
  conversationId: string;
  events: MlsControlBatchItem[];
}

interface LocalMlsStateV1 {
  version: 1;
  providerStateB64: string;
  credentialB64: string;
  publicKeyB64: string;
  pendingAckEventIds: string[];
  pendingOutboundTransition: PendingOutboundTransition | null;
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
  return item as PendingOutboundTransition;
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
  return {
    version: STATE_VERSION,
    providerStateB64: raw.providerStateB64,
    credentialB64: raw.credentialB64,
    publicKeyB64: raw.publicKeyB64,
    pendingAckEventIds: raw.pendingAckEventIds,
    pendingOutboundTransition: parsePendingOutbound(raw.pendingOutboundTransition),
  };
}

function serializeLocalState(state: LocalMlsStateV1): Uint8Array {
  return utf8(JSON.stringify(state));
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}

function cloneLocalState(state: LocalMlsStateV1): LocalMlsStateV1 {
  return JSON.parse(JSON.stringify(state)) as LocalMlsStateV1;
}

interface RuntimeSnapshot {
  providerState: Uint8Array;
  localState: LocalMlsStateV1;
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
        pendingOutboundTransition: null,
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
    await this.flushPendingOutboundTransition();
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

  async addMemberDurably(
    conversationId: string,
    keyPackage: ClaimedMlsKeyPackage,
    commitRecipients: MlsControlRecipient[],
    welcomeRecipients: MlsControlRecipient[],
  ): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady();
      this.assertNoPendingOutboundTransition();

      const snapshot = this.snapshotRuntime();
      try {
        const change = this.provider!.addMember(
          this.identity!,
          utf8(conversationId),
          base64ToBytes(keyPackage.key_package_b64),
        );

        const events: MlsControlBatchItem[] = [];
        if (commitRecipients.length > 0) {
          events.push({
            client_id: crypto.randomUUID(),
            kind: "commit",
            payload_b64: bytesToBase64(change.commitBytes()),
            recipients: commitRecipients,
          });
        }
        if (welcomeRecipients.length > 0) {
          events.push({
            client_id: crypto.randomUUID(),
            kind: "welcome",
            payload_b64: bytesToBase64(change.welcomeBytes()),
            recipients: welcomeRecipients,
          });
        }
        if (events.length === 0) {
          throw new Error("MLS membership transition has no delivery recipients");
        }

        this.localState!.pendingOutboundTransition = { conversationId, events };
        await this.persistCurrentState();
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }

      // From here the prepared transition is durable. Network failure must keep
      // that state so initialization can retry the same idempotent batch.
      await this.flushPendingOutboundTransition();
    });
  }

  async removeMemberDurably(
    conversationId: string,
    memberCredential: Uint8Array,
    commitRecipients: MlsControlRecipient[],
  ): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady();
      this.assertNoPendingOutboundTransition();
      if (commitRecipients.length === 0) {
        throw new Error("MLS removal transition has no delivery recipients");
      }

      const snapshot = this.snapshotRuntime();
      try {
        const commit = this.provider!.removeMember(
          this.identity!,
          utf8(conversationId),
          memberCredential,
        );
        this.localState!.pendingOutboundTransition = {
          conversationId,
          events: [{
            client_id: crypto.randomUUID(),
            kind: "commit",
            payload_b64: bytesToBase64(commit),
            recipients: commitRecipients,
          }],
        };
        await this.persistCurrentState();
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }

      await this.flushPendingOutboundTransition();
    });
  }

  async syncControlEvents(conversationId: string): Promise<number> {
    return this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingOutboundTransition();
      await this.flushPendingAcks();
      const events = await messengerApi.mlsControlEvents(
        conversationId,
        this.options.deviceId,
        0,
      );
      let processed = 0;

      for (const event of events) {
        const snapshot = this.snapshotRuntime();
        let durableMutation = false;
        try {
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
          durableMutation = true;
          await this.ackAndForget(event);
          processed += 1;
        } catch (error) {
          if (!durableMutation) this.restoreRuntime(snapshot);
          throw error;
        }
      }

      return processed;
    });
  }

  private async mutate<T>(
    operation: (provider: Provider, identity: DeviceIdentity) => T | Promise<T>,
  ): Promise<T> {
    return this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingOutboundTransition();
      const snapshot = this.snapshotRuntime();
      try {
        const result = await operation(this.provider!, this.identity!);
        await this.persistCurrentState();
        return result;
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }
    });
  }

  private async persistCurrentState(): Promise<void> {
    this.assertReady();
    this.localState!.providerStateB64 = bytesToBase64(this.provider!.exportState());
    await this.stateStore.put(this.stateKey, serializeLocalState(this.localState!));
  }

  private async flushPendingOutboundTransition(): Promise<void> {
    this.assertReady();
    const pending = this.localState!.pendingOutboundTransition;
    if (!pending) return;

    await messengerApi.sendMlsControlBatch(
      pending.conversationId,
      this.options.deviceId,
      pending.events,
    );

    // Durable local state still contains PendingCommit + retry marker here.
    // If merge persistence fails, restore exactly that state.
    const pendingSnapshot = this.snapshotRuntime();
    try {
      this.provider!.mergePendingCommit(utf8(pending.conversationId));
      await this.persistCurrentState();
    } catch (error) {
      this.restoreRuntime(pendingSnapshot);
      throw error;
    }

    // Merged provider state is now durable. Keep the retry marker in memory if
    // clearing it cannot be persisted; replaying the batch + merge is idempotent.
    this.localState!.pendingOutboundTransition = null;
    try {
      await this.persistCurrentState();
    } catch (error) {
      this.localState!.pendingOutboundTransition = pending;
      throw error;
    }
  }

  private async flushPendingAcks(): Promise<void> {
    this.assertReady();
    for (const eventId of [...this.localState!.pendingAckEventIds]) {
      await messengerApi.ackMlsControlEvent(eventId, this.options.deviceId);
      const previous = [...this.localState!.pendingAckEventIds];
      this.localState!.pendingAckEventIds =
        this.localState!.pendingAckEventIds.filter((item) => item !== eventId);
      try {
        await this.persistCurrentState();
      } catch (error) {
        this.localState!.pendingAckEventIds = previous;
        throw error;
      }
    }
  }

  private async ackAndForget(event: MlsControlEvent): Promise<void> {
    await messengerApi.ackMlsControlEvent(event.id, this.options.deviceId);
    const previous = [...this.localState!.pendingAckEventIds];
    this.localState!.pendingAckEventIds =
      this.localState!.pendingAckEventIds.filter((item) => item !== event.id);
    try {
      await this.persistCurrentState();
    } catch (error) {
      this.localState!.pendingAckEventIds = previous;
      throw error;
    }
  }

  private snapshotRuntime(): RuntimeSnapshot {
    this.assertReady();
    return {
      providerState: this.provider!.exportState(),
      localState: cloneLocalState(this.localState!),
    };
  }

  private restoreRuntime(snapshot: RuntimeSnapshot): void {
    if (!this.module) throw new Error("OpenMLS runtime is not initialized");
    this.provider = this.module.Provider.fromState(snapshot.providerState);
    this.localState = cloneLocalState(snapshot.localState);
  }

  private assertNoPendingOutboundTransition(): void {
    if (this.localState!.pendingOutboundTransition) {
      throw new Error("An MLS membership transition is already pending delivery");
    }
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

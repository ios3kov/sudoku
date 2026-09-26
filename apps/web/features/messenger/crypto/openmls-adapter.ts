import { projectEncryptedEvents, type EncryptedEventRecord, type EncryptedProjectionResult } from "@sudoku/domain";
import { messengerApi } from "../api";
import type {
  ClaimedMlsKeyPackage,
  Conversation,
  E2eeEnvelope,
  MlsControlBatchItem,
  MlsControlEvent,
  MlsControlRecipient,
  MlsTransportEvent,
  Message,
} from "../types";
import { BrowserProtocolStateStore } from "./browser-state-store";
import { loadOpenMlsWasm } from "./openmls-runtime";
import type {
  DecryptedMessage,
  EncryptedTransportRecord,
  OutboundPlaintext,
  ProtocolAdapter,
} from "./protocol-adapter";

import {
  PROTOCOL,
  STATE_VERSION,
  base64ToBytes,
  bytesToBase64,
  cloneLocalState,
  makeEnvelope,
  parseLocalState,
  serializeLocalState,
  uniqueIds,
  utf8,
  utf8String,
  type LocalMlsStateV1,
  type PeerIdentityPin,
  type RuntimeSnapshot,
} from "./openmls-state";
import {
  cloneDomainEvent,
  decryptApplicationEvent,
  decryptedMessageFromDomainEvent,
  toDomainEvent,
} from "./openmls-events";

export interface OpenMlsAdapterOptions {
  userId: string;
  deviceId: string;
  stateStore?: BrowserProtocolStateStore;
}

type MlsModule = Awaited<ReturnType<typeof loadOpenMlsWasm>>;
type Provider = InstanceType<MlsModule["Provider"]>;
type DeviceIdentity = ReturnType<Provider["createDeviceIdentity"]>;

export class PeerIdentityChangedError extends Error {
  constructor(userId: string, deviceId: string) {
    super("MLS identity changed for " + userId + "/" + deviceId);
    this.name = "PeerIdentityChangedError";
  }
}

// React Strict Mode and fast remounts can initialize the same authenticated
// device more than once in one browser tab. Serialize by durable state key so
// only one initializer can create/persist a fresh MLS identity at a time.
const initializationQueues = new Map<string, Promise<void>>();

export class OpenMlsProtocolAdapter implements ProtocolAdapter {
  readonly protocol = PROTOCOL;
  private module: MlsModule | null = null;
  private provider: Provider | null = null;
  private identity: DeviceIdentity | null = null;
  private localState: LocalMlsStateV1 | null = null;
  private retired = false;
  private readonly stateStore: BrowserProtocolStateStore;
  private readonly stateKey: string;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly transportSyncs = new Map<
    string,
    { promise: Promise<number>; rerun: boolean }
  >();

  constructor(private readonly options: OpenMlsAdapterOptions) {
    this.stateStore = options.stateStore ?? new BrowserProtocolStateStore();
    this.stateKey = `mls:v1:${options.userId}:${options.deviceId}`;
  }

  get ready(): boolean {
    return Boolean(!this.retired && this.module && this.provider && this.identity && this.localState);
  }

  retire(): void {
    if (this.retired) return;
    this.retired = true;
    this.stateStore.close(this.stateKey);
  }

  async initialize(): Promise<void> {
    this.assertActive();
    const previous = initializationQueues.get(this.stateKey) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.initializeUnlocked());
    initializationQueues.set(this.stateKey, current);

    try {
      await current;
    } finally {
      if (initializationQueues.get(this.stateKey) === current) {
        initializationQueues.delete(this.stateKey);
      }
    }
  }

  private async initializeUnlocked(): Promise<void> {
    this.assertActive();
    const wasm = await loadOpenMlsWasm();
    this.assertActive();
    const stored = await this.stateStore.get(this.stateKey);
    this.assertActive();

    let provider: Provider;
    let identity: DeviceIdentity;
    let state: LocalMlsStateV1;

    if (stored) {
      state = parseLocalState(stored);
      provider = wasm.Provider.fromState(base64ToBytes(state.providerStateB64));
      identity = wasm.DeviceIdentity.fromPublic(
        base64ToBytes(state.credentialB64),
        base64ToBytes(state.publicKeyB64),
      );
    } else {
      provider = new wasm.Provider();
      const credential = utf8(`sudoku-v1:${this.options.userId}:${this.options.deviceId}`);
      identity = provider.createDeviceIdentity(credential);
      state = {
        version: STATE_VERSION,
        providerStateB64: bytesToBase64(provider.exportState()),
        credentialB64: bytesToBase64(identity.credentialBytes()),
        publicKeyB64: bytesToBase64(identity.publicKeyBytes()),
        pendingAckEventIds: [],
        pendingOutboundTransition: null,
        peerIdentityPins: {},
        eventJournal: {},
        pendingApplicationSends: [],
        pendingKeyPackagesB64: [],
        transportCursors: {},
        trackedConversations: [],
        historyUnavailableConversations: [],
      };
      this.assertActive();
      await this.stateStore.put(this.stateKey, serializeLocalState(state));
      this.assertActive();
    }

    this.assertActive();
    this.module = wasm;
    this.provider = provider;
    this.identity = identity;
    this.localState = state;

    await messengerApi.registerMlsDevice(
      this.options.deviceId,
      bytesToBase64(identity.publicKeyBytes()),
    );
    this.assertActive();
    await this.flushPendingKeyPackages();
    await this.flushPendingOutboundTransition();
    await this.flushPendingApplicationSends();
    await this.flushPendingAcks();

    // Keep initial KeyPackage generation inside the same cross-instance
    // initialization lock. Otherwise a cancelled Strict-Mode mount can publish
    // KeyPackages from provider state that a later mount overwrites.
    await this.ensureKeyPackagePool(10);
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
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new Error("KeyPackage count must be between 1 and 100");
    }

    await this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingKeyPackages();

      const snapshot = this.snapshotRuntime();
      try {
        const packages: string[] = [];
        for (let index = 0; index < count; index += 1) {
          packages.push(
            bytesToBase64(this.provider!.createKeyPackage(this.identity!)),
          );
        }
        this.localState!.pendingKeyPackagesB64 = packages;
        await this.persistCurrentState();
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }

      await this.flushPendingKeyPackages();
    });
  }

  async ensureKeyPackagePool(target = 10): Promise<number> {
    if (!Number.isInteger(target) || target < 1 || target > 100) {
      throw new Error("KeyPackage target must be between 1 and 100");
    }
    this.assertReady();
    await this.flushPendingKeyPackages();

    const devices = await messengerApi.mlsDevices(this.options.userId);
    const current = devices.find((item) => item.device_id === this.options.deviceId);
    const available = current?.available_key_packages ?? 0;
    const missing = Math.max(0, target - available);
    if (missing > 0) {
      await this.createAndPublishKeyPackages(missing);
    }
    return target;
  }

  async clearLocalState(): Promise<void> {
    await this.stateStore.delete(this.stateKey);
    this.module = null;
    this.provider = null;
    this.identity = null;
    this.localState = null;
  }

  async createGroup(conversationId: string): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady();
      if (this.localState!.trackedConversations.includes(conversationId)) return;

      const snapshot = this.snapshotRuntime();
      try {
        this.provider!.createGroup(this.identity!, utf8(conversationId));
        this.localState!.trackedConversations = uniqueIds([
          ...this.localState!.trackedConversations,
          conversationId,
        ]);
        await this.persistCurrentState();
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }
    });
  }

  async bootstrapConversation(conversation: Conversation): Promise<Conversation> {
    if (!conversation.encryption_required) {
      throw new Error("Conversation is not configured for E2EE");
    }
    if (conversation.e2ee_ready) return conversation;
    if (conversation.created_by !== this.options.userId) {
      throw new Error("Only the secure conversation creator can resume setup");
    }

    await this.createGroup(conversation.id);

    const deviceGroups = await Promise.all(
      conversation.members.map(async (member) => ({
        member,
        devices: await messengerApi.mlsDevices(member.id),
      })),
    );

    const targets: Array<{
      userId: string;
      deviceId: string;
      identityPublicKeyB64: string;
      availableKeyPackages: number;
    }> = [];

    for (const { member, devices } of deviceGroups) {
      if (member.id !== this.options.userId && devices.length === 0) {
        throw new Error(member.display_name + " has no secure device ready yet");
      }
      for (const device of devices) {
        if (
          member.id === this.options.userId
          && device.device_id === this.options.deviceId
        ) {
          continue;
        }
        targets.push({
          userId: member.id,
          deviceId: device.device_id,
          identityPublicKeyB64: device.identity_public_key_b64,
          availableKeyPackages: device.available_key_packages,
        });
      }
    }

    targets.sort((left, right) =>
      (left.userId + ":" + left.deviceId).localeCompare(
        right.userId + ":" + right.deviceId,
      )
    );

    const existingRecipients: MlsControlRecipient[] = [];
    const pendingTargets: typeof targets = [];

    for (const target of targets) {
      const pinKey = this.peerPinKey(target.userId, target.deviceId);
      const pin = this.localState!.peerIdentityPins[pinKey];
      if (pin && pin.publicKeyB64 !== target.identityPublicKeyB64) {
        throw new PeerIdentityChangedError(target.userId, target.deviceId);
      }

      let alreadyMember = false;
      try {
        this.provider!.validateGroupMemberIdentity(
          utf8(conversation.id),
          utf8("sudoku-v1:" + target.userId + ":" + target.deviceId),
          base64ToBytes(pin?.publicKeyB64 ?? target.identityPublicKeyB64),
        );
        alreadyMember = true;
      } catch {
        alreadyMember = false;
      }

      if (alreadyMember) {
        existingRecipients.push({
          user_id: target.userId,
          device_id: target.deviceId,
        });
      } else {
        pendingTargets.push(target);
      }
    }

    for (const target of pendingTargets) {
      if (target.availableKeyPackages < 1) {
        throw new Error(
          "Secure device " + target.deviceId + " needs a fresh KeyPackage",
        );
      }

      const claimed = await messengerApi.claimMlsKeyPackage(
        target.userId,
        target.deviceId,
      );
      if (
        claimed.user_id !== target.userId
        || claimed.device_id !== target.deviceId
        || claimed.identity_public_key_b64 !== target.identityPublicKeyB64
      ) {
        throw new Error("Claimed MLS KeyPackage identity does not match device discovery");
      }

      const recipient: MlsControlRecipient = {
        user_id: target.userId,
        device_id: target.deviceId,
      };
      await this.addMemberDurably(
        conversation.id,
        claimed,
        [...existingRecipients],
        [recipient],
      );
      existingRecipients.push(recipient);
    }

    await messengerApi.activateMlsConversation(conversation.id);
    return { ...conversation, e2ee_ready: true };
  }


  async applyMembershipAdd(
    conversation: Conversation,
    userId: string,
    membershipChangeId: string,
  ): Promise<void> {
    if (
      conversation.type !== "group"
      || !conversation.encryption_required
      || !conversation.e2ee_ready
    ) {
      throw new Error("Encrypted group is not ready for membership changes");
    }

    const existingRecipients = await this.reconcileActiveDevices(
      conversation,
      membershipChangeId,
    );
    const devices = await messengerApi.mlsDevices(userId);
    if (devices.length === 0) {
      throw new Error("New member has no active secure device");
    }

    const pending = devices.filter((device) =>
      !this.groupHasDevice(
        conversation.id,
        userId,
        device.device_id,
        device.identity_public_key_b64,
      )
    );
    for (const device of pending) {
      if (device.available_key_packages < 1) {
        throw new Error("New member device needs a fresh KeyPackage");
      }
    }

    for (const device of pending) {
      const claimed = await messengerApi.claimMlsKeyPackage(
        userId,
        device.device_id,
      );
      if (
        claimed.user_id !== userId
        || claimed.device_id !== device.device_id
        || claimed.identity_public_key_b64 !== device.identity_public_key_b64
      ) {
        throw new Error("Claimed MLS KeyPackage identity does not match device discovery");
      }
      const recipient: MlsControlRecipient = {
        user_id: userId,
        device_id: device.device_id,
      };
      await this.addMemberDurably(
        conversation.id,
        claimed,
        [...existingRecipients],
        [recipient],
        membershipChangeId,
      );
      existingRecipients.push(recipient);
    }
  }

  async applyMembershipRemove(
    conversation: Conversation,
    userId: string,
    membershipChangeId: string,
  ): Promise<void> {
    if (
      conversation.type !== "group"
      || !conversation.encryption_required
      || !conversation.e2ee_ready
    ) {
      throw new Error("Encrypted group is not ready for membership changes");
    }

    const activeRecipients = await this.reconcileActiveDevices(
      conversation,
      membershipChangeId,
    );
    const activeTargetDevices = await messengerApi.mlsDevices(userId);
    const candidates = new Set<string>([
      ...activeTargetDevices.map((device) => device.device_id),
      ...Object.values(this.localState!.peerIdentityPins)
        .filter((pin) => pin.userId === userId)
        .map((pin) => pin.deviceId),
    ]);

    const orderedCandidates = [...candidates].sort((left, right) => {
      if (left === this.options.deviceId) return 1;
      if (right === this.options.deviceId) return -1;
      return left.localeCompare(right);
    });

    let removed = 0;
    for (const deviceId of orderedCandidates) {
      const active = activeTargetDevices.find((item) => item.device_id === deviceId);
      const pin = this.localState!.peerIdentityPins[this.peerPinKey(userId, deviceId)];
      const publicKeyB64 = pin?.publicKeyB64 ?? active?.identity_public_key_b64;
      if (!publicKeyB64) continue;
      if (!this.groupHasDevice(conversation.id, userId, deviceId, publicKeyB64)) {
        continue;
      }

      await this.removeMemberDurably(
        conversation.id,
        utf8("sudoku-v1:" + userId + ":" + deviceId),
        [...activeRecipients],
        membershipChangeId,
      );
      removed += 1;
      const index = activeRecipients.findIndex(
        (item) => item.user_id === userId && item.device_id === deviceId,
      );
      if (index >= 0) activeRecipients.splice(index, 1);
    }

    if (removed === 0) {
      throw new Error("No MLS device leaf found for the member");
    }
  }

  private async reconcileActiveDevices(
    conversation: Conversation,
    membershipChangeId: string,
  ): Promise<MlsControlRecipient[]> {
    this.assertReady();
    const targets: Array<{
      userId: string;
      deviceId: string;
      identityPublicKeyB64: string;
      availableKeyPackages: number;
    }> = [];

    for (const member of conversation.members) {
      const devices = await messengerApi.mlsDevices(member.id);
      for (const device of devices) {
        if (
          member.id === this.options.userId
          && device.device_id === this.options.deviceId
        ) {
          continue;
        }
        targets.push({
          userId: member.id,
          deviceId: device.device_id,
          identityPublicKeyB64: device.identity_public_key_b64,
          availableKeyPackages: device.available_key_packages,
        });
      }
    }
    targets.sort((left, right) =>
      (left.userId + ":" + left.deviceId).localeCompare(
        right.userId + ":" + right.deviceId,
      )
    );

    const recipients: MlsControlRecipient[] = [];
    const missing: typeof targets = [];
    for (const target of targets) {
      if (
        this.groupHasDevice(
          conversation.id,
          target.userId,
          target.deviceId,
          target.identityPublicKeyB64,
        )
      ) {
        recipients.push({
          user_id: target.userId,
          device_id: target.deviceId,
        });
      } else {
        missing.push(target);
      }
    }

    for (const target of missing) {
      if (target.availableKeyPackages < 1) {
        throw new Error("Active group device needs a fresh KeyPackage");
      }
      const claimed = await messengerApi.claimMlsKeyPackage(
        target.userId,
        target.deviceId,
      );
      if (
        claimed.user_id !== target.userId
        || claimed.device_id !== target.deviceId
        || claimed.identity_public_key_b64 !== target.identityPublicKeyB64
      ) {
        throw new Error("Claimed MLS KeyPackage identity does not match device discovery");
      }
      const recipient: MlsControlRecipient = {
        user_id: target.userId,
        device_id: target.deviceId,
      };
      await this.addMemberDurably(
        conversation.id,
        claimed,
        [...recipients],
        [recipient],
        membershipChangeId,
      );
      recipients.push(recipient);
    }

    return recipients;
  }

  private groupHasDevice(
    conversationId: string,
    userId: string,
    deviceId: string,
    publicKeyB64: string,
  ): boolean {
    this.assertReady();
    const pin = this.localState!.peerIdentityPins[this.peerPinKey(userId, deviceId)];
    if (pin && pin.publicKeyB64 !== publicKeyB64) {
      throw new PeerIdentityChangedError(userId, deviceId);
    }
    try {
      this.provider!.validateGroupMemberIdentity(
        utf8(conversationId),
        utf8("sudoku-v1:" + userId + ":" + deviceId),
        base64ToBytes(pin?.publicKeyB64 ?? publicKeyB64),
      );
      return true;
    } catch {
      return false;
    }
  }


  async addMemberDurably(
    conversationId: string,
    keyPackage: ClaimedMlsKeyPackage,
    commitRecipients: MlsControlRecipient[],
    welcomeRecipients: MlsControlRecipient[],
    membershipChangeId: string | null = null,
  ): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingApplicationSends(conversationId);
      this.assertNoPendingApplicationSends(conversationId);
      this.assertNoPendingOutboundTransition();

      const snapshot = this.snapshotRuntime();
      try {
        const packageBytes = base64ToBytes(keyPackage.key_package_b64);
        const expectedPublicKey = base64ToBytes(keyPackage.identity_public_key_b64);
        const expectedCredential = utf8(
          "sudoku-v1:" + keyPackage.user_id + ":" + keyPackage.device_id,
        );
        const pinKey = this.peerPinKey(keyPackage.user_id, keyPackage.device_id);
        const existingPin = this.localState!.peerIdentityPins[pinKey];

        if (existingPin && existingPin.publicKeyB64 !== keyPackage.identity_public_key_b64) {
          throw new PeerIdentityChangedError(keyPackage.user_id, keyPackage.device_id);
        }

        this.provider!.validateKeyPackageIdentity(
          packageBytes,
          expectedCredential,
          expectedPublicKey,
        );

        if (!existingPin) {
          this.localState!.peerIdentityPins[pinKey] = {
            userId: keyPackage.user_id,
            deviceId: keyPackage.device_id,
            publicKeyB64: keyPackage.identity_public_key_b64,
            firstSeenAt: Date.now(),
            verifiedAt: null,
          };
        }

        const change = this.provider!.addMember(
          this.identity!,
          utf8(conversationId),
          packageBytes,
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

        this.localState!.pendingOutboundTransition = {
          conversationId,
          membershipChangeId,
          events,
        };
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
    membershipChangeId: string | null = null,
  ): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingApplicationSends(conversationId);
      this.assertNoPendingApplicationSends(conversationId);
      this.assertNoPendingOutboundTransition();
      const snapshot = this.snapshotRuntime();
      try {
        const commit = this.provider!.removeMember(
          this.identity!,
          utf8(conversationId),
          memberCredential,
        );
        this.localState!.pendingOutboundTransition = {
          conversationId,
          membershipChangeId,
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

  async encrypt(input: OutboundPlaintext): Promise<E2eeEnvelope> {
    const payload = utf8(JSON.stringify({
      version: 1,
      kind: "message",
      messageType: input.messageType,
      body: input.body,
      replyTo: input.replyTo,
      assetIds: input.assetIds,
      attachments: input.attachments ?? [],
    }));

    return this.mutate((provider, identity) => {
      const ciphertext = provider.encryptApplication(
        identity,
        utf8(input.conversationId),
        payload,
      );
      return makeEnvelope(ciphertext, "application");
    });
  }

  async encryptEdit(
    conversationId: string,
    targetMessageId: string,
    body: string,
  ): Promise<E2eeEnvelope> {
    if (!targetMessageId || !body) throw new Error("Invalid encrypted edit event");
    return this.encryptApplicationEvent(conversationId, {
      version: 1,
      kind: "edit",
      targetMessageId,
      body,
    });
  }

  async encryptReaction(
    conversationId: string,
    targetMessageId: string,
    emoji: string,
    active: boolean,
  ): Promise<E2eeEnvelope> {
    if (!targetMessageId || !emoji) throw new Error("Invalid encrypted reaction event");
    return this.encryptApplicationEvent(conversationId, {
      version: 1,
      kind: "reaction",
      targetMessageId,
      emoji,
      active,
    });
  }

  async encryptDelete(
    conversationId: string,
    targetMessageId: string,
  ): Promise<E2eeEnvelope> {
    if (!targetMessageId) throw new Error("Invalid encrypted delete event");
    return this.encryptApplicationEvent(conversationId, {
      version: 1,
      kind: "delete",
      targetMessageId,
    });
  }

  async decrypt(
    conversationId: string,
    envelope: E2eeEnvelope,
  ): Promise<DecryptedMessage> {
    return this.mutate((provider) =>
      decryptApplicationEvent(provider, conversationId, envelope)
    );
  }

  async sendMessageDurably(
    input: OutboundPlaintext,
    clientId = crypto.randomUUID(),
    onPrepared?: (clientId: string) => void,
  ): Promise<Message> {
    const event: EncryptedEventRecord["event"] = {
      kind: "message",
      messageType: input.messageType,
      body: input.body,
      replyTo: input.replyTo,
      assetIds: [...input.assetIds],
      attachments: (input.attachments ?? []).map((item) => ({ ...item })),
    };
    return this.queueApplicationSend(
      input.conversationId,
      clientId,
      event,
      input.messageType,
      input.assetIds,
      onPrepared,
    );
  }

  async sendEditDurably(
    conversationId: string,
    targetMessageId: string,
    body: string,
    clientId = crypto.randomUUID(),
  ): Promise<Message> {
    if (!targetMessageId || !body) throw new Error("Invalid encrypted edit event");
    return this.queueApplicationSend(
      conversationId,
      clientId,
      { kind: "edit", targetMessageId, body },
      "text",
      [],
    );
  }

  async sendReactionDurably(
    conversationId: string,
    targetMessageId: string,
    emoji: string,
    active: boolean,
    clientId = crypto.randomUUID(),
  ): Promise<Message> {
    if (!targetMessageId || !emoji) throw new Error("Invalid encrypted reaction event");
    return this.queueApplicationSend(
      conversationId,
      clientId,
      { kind: "reaction", targetMessageId, emoji, active },
      "text",
      [],
    );
  }

  async sendDeleteDurably(
    conversationId: string,
    targetMessageId: string,
    clientId = crypto.randomUUID(),
  ): Promise<Message> {
    if (!targetMessageId) throw new Error("Invalid encrypted delete event");
    return this.queueApplicationSend(
      conversationId,
      clientId,
      { kind: "delete", targetMessageId },
      "text",
      [],
    );
  }

  pendingApplicationCount(conversationId?: string): number {
    this.assertReady();
    if (!conversationId) return this.localState!.pendingApplicationSends.length;
    return this.localState!.pendingApplicationSends.filter(
      (item) => item.conversationId === conversationId,
    ).length;
  }

  pendingApplicationMessages(conversationId: string): Array<{ id: string; body: string | null; messageType: "text" | "image" | "file" | "voice" }> {
    this.assertReady();
    return this.localState!.pendingApplicationSends.flatMap((item) =>
      item.conversationId === conversationId && item.event.kind === "message"
        ? [{ id: item.clientId, body: item.event.body, messageType: item.event.messageType }]
        : [],
    );
  }

  async retryPendingApplicationSend(clientId: string): Promise<Message | null> {
    if (!clientId) throw new Error("Pending encrypted message id is required");
    return this.enqueue(async () => {
      this.assertReady();
      const pending = this.localState!.pendingApplicationSends.find(
        (item) => item.clientId === clientId && item.event.kind === "message",
      );
      if (!pending) return null;
      const delivered = await this.flushPendingApplicationSends(pending.conversationId);
      return delivered.get(clientId) ?? null;
    });
  }

  async discardPendingApplicationSend(clientId: string): Promise<boolean> {
    if (!clientId) throw new Error("Pending encrypted message id is required");
    return this.enqueue(async () => {
      this.assertReady();
      const pending = this.localState!.pendingApplicationSends.find(
        (item) => item.clientId === clientId && item.event.kind === "message",
      );
      if (!pending) return false;

      const snapshot = this.snapshotRuntime();
      try {
        this.localState!.pendingApplicationSends =
          this.localState!.pendingApplicationSends.filter(
            (item) => item.clientId !== clientId,
          );
        await this.persistCurrentState();
        return true;
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }
    });
  }

  async decryptAndJournal(
    conversationId: string,
    record: EncryptedTransportRecord,
  ): Promise<DecryptedMessage> {
    if (!record.id || !record.senderId || !Number.isInteger(record.sequence) || record.sequence <= 0) {
      throw new Error("Invalid encrypted transport record");
    }

    return this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingOutboundTransition();

      const existing = this.localState!.eventJournal[conversationId]?.find(
        (item) => item.eventId === record.id,
      );
      if (existing) {
        return decryptedMessageFromDomainEvent(existing.event);
      }

      const snapshot = this.snapshotRuntime();
      try {
        const decrypted = decryptApplicationEvent(
          this.provider!,
          conversationId,
          record.envelope,
        );
        const journal = this.localState!.eventJournal[conversationId] ?? [];
        journal.push({
          eventId: record.id,
          senderId: record.senderId,
          sequence: record.sequence,
          ...(record.createdAt ? { createdAt: record.createdAt } : {}),
          event: toDomainEvent(decrypted.event),
        });
        this.localState!.eventJournal[conversationId] = journal;
        await this.persistCurrentState();
        return decrypted;
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }
    });
  }

  transportCursor(conversationId: string): number {
    this.assertReady();
    return this.localState!.transportCursors[conversationId] ?? 0;
  }

  joinedConversationIds(): string[] {
    this.assertReady();
    return [...this.localState!.trackedConversations].sort();
  }

  trackedConversationIds(): string[] {
    this.assertReady();
    const ids = new Set<string>([
      ...this.localState!.trackedConversations,
      ...Object.keys(this.localState!.transportCursors),
      ...Object.keys(this.localState!.eventJournal),
      ...this.localState!.pendingApplicationSends.map((item) => item.conversationId),
    ]);
    if (this.localState!.pendingOutboundTransition) {
      ids.add(this.localState!.pendingOutboundTransition.conversationId);
    }
    return [...ids].sort();
  }

  historyUnavailableConversationIds(): string[] {
    this.assertReady();
    return [...this.localState!.historyUnavailableConversations].sort();
  }

  projectConversation(conversationId: string): EncryptedProjectionResult {
    this.assertReady();
    return projectEncryptedEvents(this.localState!.eventJournal[conversationId] ?? []);
  }

  async syncTransport(conversationId: string): Promise<number> {
    const existing = this.transportSyncs.get(conversationId);
    if (existing) {
      // Reconnect, realtime and explicit UI refreshes can arrive together.
      // Coalesce them into one in-flight sync plus at most one follow-up pass
      // instead of building an unbounded operationQueue backlog.
      existing.rerun = true;
      return existing.promise;
    }

    const record: { promise: Promise<number>; rerun: boolean } = {
      promise: Promise.resolve(0),
      rerun: false,
    };

    record.promise = (async () => {
      let processed = 0;
      try {
        do {
          record.rerun = false;
          let batchProcessed = 0;
          do {
            batchProcessed = await this.syncTransportOnce(conversationId);
            processed += batchProcessed;
          } while (batchProcessed > 0);
        } while (record.rerun);
        return processed;
      } finally {
        if (this.transportSyncs.get(conversationId) === record) {
          this.transportSyncs.delete(conversationId);
        }
      }
    })();

    this.transportSyncs.set(conversationId, record);
    return record.promise;
  }

  private async syncTransportOnce(conversationId: string): Promise<number> {
    return this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingOutboundTransition();
      await this.flushPendingApplicationSends();
      await this.flushPendingAcks();

      const cursor = this.localState!.transportCursors[conversationId] ?? 0;
      const events = await messengerApi.mlsTransportEvents(
        conversationId,
        this.options.deviceId,
        cursor,
      );
      let processed = 0;

      for (const item of events) {
        if (
          !Number.isSafeInteger(item.transport_sequence)
          || item.transport_sequence <= (this.localState!.transportCursors[conversationId] ?? 0)
        ) {
          throw new Error("Invalid or non-monotonic MLS transport sequence");
        }

        if (item.kind === "message") {
          await this.processTransportMessage(conversationId, item);
        } else {
          await this.processTransportControl(conversationId, item);
        }
        processed += 1;
      }

      return processed;
    });
  }

  async syncControlEvents(conversationId: string): Promise<number> {
    return this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingOutboundTransition();
      await this.flushPendingApplicationSends();
      await this.flushPendingAcks();
      const events = await messengerApi.mlsControlEvents(
        conversationId,
        this.options.deviceId,
        0,
      );
      let processed = 0;

      for (const event of events) {
        const senderIdentity = await this.resolveControlSenderIdentity(event);
        const snapshot = this.snapshotRuntime();
        let durableMutation = false;
        try {
          const expectedCredential = utf8(
            "sudoku-v1:" + event.sender_user_id + ":" + event.sender_device_id,
          );
          const expectedPublicKey = base64ToBytes(senderIdentity.publicKeyB64);

          if (event.kind === "welcome") {
            const joined = utf8String(
              this.provider!.joinGroup(base64ToBytes(event.payload_b64)),
            );
            if (joined !== conversationId) {
              throw new Error("MLS Welcome group id does not match conversation");
            }
            this.localState!.trackedConversations = uniqueIds([
              ...this.localState!.trackedConversations,
              conversationId,
            ]);
            this.provider!.validateGroupMemberIdentity(
              utf8(conversationId),
              expectedCredential,
              expectedPublicKey,
            );
          } else if (event.kind === "commit") {
            this.provider!.validateGroupMemberIdentity(
              utf8(conversationId),
              expectedCredential,
              expectedPublicKey,
            );
            this.provider!.processHandshake(
              utf8(conversationId),
              base64ToBytes(event.payload_b64),
            );
          } else {
            throw new Error("Unsupported MLS control event");
          }

          if (!senderIdentity.existingPin) {
            this.localState!.peerIdentityPins[senderIdentity.pinKey] = {
              userId: event.sender_user_id,
              deviceId: event.sender_device_id,
              publicKeyB64: senderIdentity.publicKeyB64,
              firstSeenAt: Date.now(),
              verifiedAt: null,
            };
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

  private async processTransportMessage(
    conversationId: string,
    item: Extract<MlsTransportEvent, { kind: "message" }>,
  ): Promise<void> {
    const cursorBefore = this.localState!.transportCursors[conversationId] ?? 0;

    // A newly registered device is a legitimate conversation member at the
    // application layer before it has received its MLS Welcome. Old-epoch
    // ciphertext is intentionally not decryptable on that device. Advance the
    // durable transport cursor until the Welcome arrives instead of turning
    // this expected state into a generic E2EE failure/reload loop.
    if (!this.localState!.trackedConversations.includes(conversationId)) {
      const snapshot = this.snapshotRuntime();
      try {
        this.localState!.historyUnavailableConversations = uniqueIds([
          ...this.localState!.historyUnavailableConversations,
          conversationId,
        ]);
        this.localState!.transportCursors[conversationId] = item.transport_sequence;
        await this.persistCurrentState();
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }
      return;
    }

    const existing = this.localState!.eventJournal[conversationId]?.find(
      (record) => record.eventId === item.message_id,
    );

    if (existing) {
      const snapshot = this.snapshotRuntime();
      try {
        if (!existing.createdAt && item.created_at) existing.createdAt = item.created_at;
        this.localState!.transportCursors[conversationId] = item.transport_sequence;
        await this.persistCurrentState();
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }
      return;
    }

    if (item.sender_user_id === this.options.userId) {
      throw new Error(
        "Own MLS message is missing its durable local journal entry",
      );
    }

    const snapshot = this.snapshotRuntime();
    try {
      const decrypted = decryptApplicationEvent(
        this.provider!,
        conversationId,
        item.envelope,
      );
      const journal = this.localState!.eventJournal[conversationId] ?? [];
      journal.push({
        eventId: item.message_id,
        senderId: item.sender_user_id,
        sequence: item.message_sequence,
        ...(item.created_at ? { createdAt: item.created_at } : {}),
        event: toDomainEvent(decrypted.event),
      });
      this.localState!.eventJournal[conversationId] = journal;
      this.localState!.transportCursors[conversationId] = item.transport_sequence;
      await this.persistCurrentState();
    } catch (error) {
      this.localState!.transportCursors[conversationId] = cursorBefore;
      this.restoreRuntime(snapshot);
      throw error;
    }
  }

  private async processTransportControl(
    conversationId: string,
    item: Extract<MlsTransportEvent, { kind: "mls_control" }>,
  ): Promise<void> {
    const event = item.control;
    const senderIdentity = await this.resolveControlSenderIdentity(event);
    const snapshot = this.snapshotRuntime();

    try {
      const expectedCredential = utf8(
        "sudoku-v1:" + event.sender_user_id + ":" + event.sender_device_id,
      );
      const expectedPublicKey = base64ToBytes(senderIdentity.publicKeyB64);

      if (event.kind === "welcome") {
        const joined = utf8String(
          this.provider!.joinGroup(base64ToBytes(event.payload_b64)),
        );
        if (joined !== conversationId) {
          throw new Error("MLS Welcome group id does not match conversation");
        }
        this.localState!.trackedConversations = uniqueIds([
          ...this.localState!.trackedConversations,
          conversationId,
        ]);
        this.provider!.validateGroupMemberIdentity(
          utf8(conversationId),
          expectedCredential,
          expectedPublicKey,
        );
      } else if (event.kind === "commit") {
        this.provider!.validateGroupMemberIdentity(
          utf8(conversationId),
          expectedCredential,
          expectedPublicKey,
        );
        this.provider!.processHandshake(
          utf8(conversationId),
          base64ToBytes(event.payload_b64),
        );
      } else {
        throw new Error("Unsupported MLS control event");
      }

      if (!senderIdentity.existingPin) {
        this.localState!.peerIdentityPins[senderIdentity.pinKey] = {
          userId: event.sender_user_id,
          deviceId: event.sender_device_id,
          publicKeyB64: senderIdentity.publicKeyB64,
          firstSeenAt: Date.now(),
          verifiedAt: null,
        };
      }

      this.localState!.pendingAckEventIds = uniqueIds([
        ...this.localState!.pendingAckEventIds,
        event.id,
      ]);
      this.localState!.transportCursors[conversationId] = item.transport_sequence;
      await this.persistCurrentState();
    } catch (error) {
      this.restoreRuntime(snapshot);
      throw error;
    }

    // The cursor and pending ACK are already durable. Network ACK failure must
    // not replay the MLS control event; flushPendingAcks retries it separately.
    await this.ackAndForget(event);
  }

  private async resolveControlSenderIdentity(event: MlsControlEvent): Promise<{
    pinKey: string;
    publicKeyB64: string;
    existingPin: PeerIdentityPin | null;
  }> {
    const pinKey = this.peerPinKey(event.sender_user_id, event.sender_device_id);
    const existingPin = this.localState!.peerIdentityPins[pinKey] ?? null;
    if (existingPin) {
      return {
        pinKey,
        publicKeyB64: existingPin.publicKeyB64,
        existingPin,
      };
    }

    const devices = await messengerApi.mlsDevices(event.sender_user_id);
    const device = devices.find((item) => item.device_id === event.sender_device_id);
    if (device) {
      return {
        pinKey,
        publicKeyB64: device.identity_public_key_b64,
        existingPin: null,
      };
    }

    const snapshot = await messengerApi.mlsControlSenderIdentity(event.id);
    if (
      snapshot.user_id !== event.sender_user_id
      || snapshot.device_id !== event.sender_device_id
    ) {
      throw new Error("MLS control sender identity snapshot mismatch");
    }
    return {
      pinKey,
      publicKeyB64: snapshot.identity_public_key_b64,
      existingPin: null,
    };
  }



  async reconcilePendingDeviceChange(
    conversation: Conversation,
  ): Promise<boolean> {
    this.assertReady();
    if (
      !conversation.encryption_required
      || !conversation.e2ee_ready
      || !this.localState!.trackedConversations.includes(conversation.id)
    ) {
      return false;
    }

    const pending = await messengerApi.pendingMlsMembershipChange(
      conversation.id,
    );
    const change = pending.change;
    if (
      !change
      || (change.kind !== "device_add" && change.kind !== "device_remove")
      || !change.target_device_id
    ) {
      return false;
    }

    if (change.kind === "device_add") {
      if (!pending.target_device?.active) {
        await messengerApi.finalizeMlsMembershipChange(change.id);
        return true;
      }
      await this.reconcileActiveDevices(conversation, change.id);
      await messengerApi.finalizeMlsMembershipChange(change.id);
      return true;
    }

    await this.discardPendingApplicationSends(conversation.id);
    const recipients = await this.reconcileActiveDevices(
      conversation,
      change.id,
    );
    const target = pending.target_device;
    if (!target) {
      throw new Error("Revoked MLS device identity is unavailable");
    }

    if (
      this.groupHasDevice(
        conversation.id,
        change.target_user_id,
        change.target_device_id,
        target.identity_public_key_b64,
      )
    ) {
      await this.removeMemberDurably(
        conversation.id,
        utf8(
          "sudoku-v1:"
          + change.target_user_id
          + ":"
          + change.target_device_id,
        ),
        recipients,
        change.id,
      );
    }

    await messengerApi.finalizeMlsMembershipChange(change.id);
    return true;
  }

  private async discardPendingApplicationSends(
    conversationId: string,
  ): Promise<number> {
    return this.enqueue(async () => {
      this.assertReady();
      const before = this.localState!.pendingApplicationSends.length;
      this.localState!.pendingApplicationSends =
        this.localState!.pendingApplicationSends.filter(
          (item) => item.conversationId !== conversationId,
        );
      const discarded =
        before - this.localState!.pendingApplicationSends.length;
      if (discarded > 0) {
        await this.persistCurrentState();
      }
      return discarded;
    });
  }


  async peerVerificationDetails(
    conversationId: string,
    peerUserId: string,
  ): Promise<Array<{
    deviceId: string;
    safetyNumber: string;
    verified: boolean;
  }>> {
    const devices = await messengerApi.mlsDevices(peerUserId);
    await this.enqueue(async () => {
      this.assertReady();
      const snapshot = this.snapshotRuntime();
      let changed = false;
      try {
        for (const device of devices) {
          const pinKey = this.peerPinKey(peerUserId, device.device_id);
          const existing = this.localState!.peerIdentityPins[pinKey];
          if (
            existing
            && existing.publicKeyB64 !== device.identity_public_key_b64
          ) {
            throw new PeerIdentityChangedError(peerUserId, device.device_id);
          }
          if (
            !this.groupHasDevice(
              conversationId,
              peerUserId,
              device.device_id,
              device.identity_public_key_b64,
            )
          ) {
            continue;
          }
          if (!existing) {
            this.localState!.peerIdentityPins[pinKey] = {
              userId: peerUserId,
              deviceId: device.device_id,
              publicKeyB64: device.identity_public_key_b64,
              firstSeenAt: Date.now(),
              verifiedAt: null,
            };
            changed = true;
          }
        }
        if (changed) await this.persistCurrentState();
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }
    });

    const output: Array<{
      deviceId: string;
      safetyNumber: string;
      verified: boolean;
    }> = [];
    for (const device of devices) {
      const pin = this.localState!.peerIdentityPins[
        this.peerPinKey(peerUserId, device.device_id)
      ];
      if (!pin) continue;
      output.push({
        deviceId: device.device_id,
        safetyNumber: await this.safetyNumber(peerUserId, device.device_id),
        verified: pin.verifiedAt !== null,
      });
    }
    return output.sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  }


  async safetyNumber(peerUserId: string, peerDeviceId: string): Promise<string> {
    this.assertReady();
    const pin = this.localState!.peerIdentityPins[this.peerPinKey(peerUserId, peerDeviceId)];
    if (!pin) throw new Error("Peer MLS identity is not pinned");

    const localOrder = this.options.userId + "\u0000" + this.options.deviceId;
    const peerOrder = pin.userId + "\u0000" + pin.deviceId;
    const records = [
      {
        order: localOrder,
        value:
          localOrder
          + "\u0000"
          + bytesToBase64(this.identity!.publicKeyBytes()),
      },
      {
        order: peerOrder,
        value: peerOrder + "\u0000" + pin.publicKeyB64,
      },
    ].sort((left, right) => left.order.localeCompare(right.order));

    const materialSource = utf8(
      "sudoku-mls-safety-v1\u0000"
      + records[0].value
      + "\u0000"
      + records[1].value,
    );
    const material = new Uint8Array(materialSource.byteLength);
    material.set(materialSource);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
    const hex = [...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    return hex.match(/.{1,4}/g)?.join(" ") ?? hex;
  }

  async markPeerIdentityVerified(peerUserId: string, peerDeviceId: string): Promise<void> {
    await this.enqueue(async () => {
      this.assertReady();
      const pin = this.localState!.peerIdentityPins[this.peerPinKey(peerUserId, peerDeviceId)];
      if (!pin) throw new Error("Peer MLS identity is not pinned");

      const previous = pin.verifiedAt;
      pin.verifiedAt = Date.now();
      try {
        await this.persistCurrentState();
      } catch (error) {
        pin.verifiedAt = previous;
        throw error;
      }
    });
  }

  private peerPinKey(userId: string, deviceId: string): string {
    return userId + ":" + deviceId;
  }

  private async queueApplicationSend(
    conversationId: string,
    clientId: string,
    event: EncryptedEventRecord["event"],
    serverType: "text" | "image" | "file" | "voice",
    assetIds: string[],
    onPrepared?: (clientId: string) => void,
  ): Promise<Message> {
    return this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingOutboundTransition();

      const existing = this.localState!.pendingApplicationSends.find(
        (item) => item.clientId === clientId,
      );
      if (!existing) {
        if (typeof navigator === "undefined" || navigator.onLine) {
          const pendingChange = await messengerApi.pendingMlsMembershipChange(
            conversationId,
          );
          if (
            pendingChange.change
            && (
              pendingChange.change.kind === "device_add"
              || pendingChange.change.kind === "device_remove"
            )
          ) {
            throw new Error("Secure device rekey is in progress");
          }
        }
        const snapshot = this.snapshotRuntime();
        try {
          const ciphertext = this.provider!.encryptApplication(
            this.identity!,
            utf8(conversationId),
            utf8(JSON.stringify({ version: 1, ...event })),
          );
          this.localState!.pendingApplicationSends.push({
            conversationId,
            clientId,
            envelope: makeEnvelope(ciphertext, "application"),
            event: cloneDomainEvent(event),
            serverType,
            assetIds: [...assetIds],
          });
          await this.persistCurrentState();
        } catch (error) {
          this.restoreRuntime(snapshot);
          throw error;
        }
      } else if (existing.conversationId !== conversationId) {
        throw new Error("Encrypted client id is already queued for another conversation");
      }

      onPrepared?.(clientId);
      const delivered = await this.flushPendingApplicationSends();
      const result = delivered.get(clientId);
      if (!result) {
        throw new Error("Encrypted message remains queued for delivery");
      }
      return result;
    });
  }

  private async flushPendingKeyPackages(): Promise<void> {
    this.assertReady();
    const pending = [...this.localState!.pendingKeyPackagesB64];
    if (pending.length === 0) return;

    await messengerApi.publishMlsKeyPackages(this.options.deviceId, pending);

    const previous = [...this.localState!.pendingKeyPackagesB64];
    this.localState!.pendingKeyPackagesB64 = [];
    try {
      await this.persistCurrentState();
    } catch (error) {
      this.localState!.pendingKeyPackagesB64 = previous;
      throw error;
    }
  }

  private async flushPendingApplicationSends(
    conversationId?: string,
  ): Promise<Map<string, Message>> {
    this.assertReady();
    if (
      this.localState!.pendingOutboundTransition
      && (
        conversationId === undefined
        || this.localState!.pendingOutboundTransition.conversationId === conversationId
      )
    ) {
      throw new Error("Cannot deliver application messages while MLS membership transition is pending");
    }

    const delivered = new Map<string, Message>();
    const pendingItems = this.localState!.pendingApplicationSends.filter(
      (item) => conversationId === undefined || item.conversationId === conversationId,
    );
    for (const pending of [...pendingItems]) {
      const response = await messengerApi.sendEncryptedMessage(
        pending.conversationId,
        pending.clientId,
        pending.envelope,
        pending.serverType,
        pending.assetIds,
        null,
      );

      const snapshot = this.snapshotRuntime();
      try {
        const journal = this.localState!.eventJournal[pending.conversationId] ?? [];
        if (!journal.some((item) => item.eventId === response.id)) {
          journal.push({
            eventId: response.id,
            senderId: response.sender_id,
            sequence: response.sequence,
            createdAt: response.created_at,
            event: cloneDomainEvent(pending.event),
          });
          this.localState!.eventJournal[pending.conversationId] = journal;
        }
        this.localState!.pendingApplicationSends =
          this.localState!.pendingApplicationSends.filter(
            (item) => item.clientId !== pending.clientId,
          );
        await this.persistCurrentState();
        delivered.set(pending.clientId, response);
      } catch (error) {
        this.restoreRuntime(snapshot);
        throw error;
      }
    }
    return delivered;
  }

  private async encryptApplicationEvent(
    conversationId: string,
    payload: Record<string, unknown>,
  ): Promise<E2eeEnvelope> {
    return this.mutate((provider, identity) => {
      const ciphertext = provider.encryptApplication(
        identity,
        utf8(conversationId),
        utf8(JSON.stringify(payload)),
      );
      return makeEnvelope(ciphertext, "application");
    });
  }

  private async mutate<T>(
    operation: (provider: Provider, identity: DeviceIdentity) => T | Promise<T>,
  ): Promise<T> {
    return this.enqueue(async () => {
      this.assertReady();
      await this.flushPendingOutboundTransition();
      await this.flushPendingApplicationSends();
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
      pending.membershipChangeId,
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

  private assertNoPendingApplicationSends(conversationId?: string): void {
    if (
      this.localState!.pendingApplicationSends.some(
        (item) => conversationId === undefined || item.conversationId === conversationId,
      )
    ) {
      throw new Error("Encrypted application messages are still pending delivery");
    }
  }

  private assertNoPendingOutboundTransition(): void {
    if (this.localState!.pendingOutboundTransition) {
      throw new Error("An MLS membership transition is already pending delivery");
    }
  }

  private assertActive(): void {
    if (this.retired) throw new Error("OpenMLS adapter is retired");
  }

  private assertReady(): void {
    this.assertActive();
    if (!this.ready) {
      throw new Error("OpenMLS adapter is not initialized");
    }
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.assertActive();
    const previous = this.operationQueue;
    let release: () => void = () => undefined;
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.assertActive();
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

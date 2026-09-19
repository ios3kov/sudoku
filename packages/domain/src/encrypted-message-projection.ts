export type EncryptedMessageType = "text" | "image" | "file" | "voice";

export type EncryptedApplicationEvent =
  | {
      kind: "message";
      messageType: EncryptedMessageType;
      body: string | null;
      replyTo: string | null;
      assetIds: string[];
      attachments: Record<string, unknown>[];
    }
  | { kind: "edit"; targetMessageId: string; body: string }
  | { kind: "reaction"; targetMessageId: string; emoji: string; active: boolean }
  | { kind: "delete"; targetMessageId: string };

export interface EncryptedEventRecord {
  eventId: string;
  senderId: string;
  sequence: number;
  event: EncryptedApplicationEvent;
}

export interface ProjectedReaction {
  emoji: string;
  userIds: string[];
}

export interface ProjectedEncryptedMessage {
  id: string;
  senderId: string;
  sequence: number;
  messageType: EncryptedMessageType;
  body: string | null;
  replyTo: string | null;
  assetIds: string[];
  attachments: Record<string, unknown>[];
  edited: boolean;
  deleted: boolean;
  reactions: ProjectedReaction[];
}

export interface EncryptedProjectionResult {
  messages: ProjectedEncryptedMessage[];
  appliedEventIds: string[];
  rejectedEventIds: string[];
}

function validRecord(record: EncryptedEventRecord): boolean {
  return Boolean(record.eventId)
    && Boolean(record.senderId)
    && Number.isInteger(record.sequence)
    && record.sequence > 0;
}

export function projectEncryptedEvents(
  records: readonly EncryptedEventRecord[],
): EncryptedProjectionResult {
  const deduplicated = new Map<string, EncryptedEventRecord>();
  for (const record of records) {
    if (!validRecord(record)) continue;
    const previous = deduplicated.get(record.eventId);
    if (!previous || record.sequence < previous.sequence) {
      deduplicated.set(record.eventId, record);
    }
  }

  const ordered = [...deduplicated.values()].sort(
    (left, right) =>
      left.sequence - right.sequence || left.eventId.localeCompare(right.eventId),
  );

  const messages = new Map<string, ProjectedEncryptedMessage>();
  const appliedEventIds: string[] = [];
  const rejectedEventIds: string[] = [];

  for (const record of ordered) {
    const event = record.event;

    if (event.kind === "message") {
      if (messages.has(record.eventId)) {
        rejectedEventIds.push(record.eventId);
        continue;
      }
      messages.set(record.eventId, {
        id: record.eventId,
        senderId: record.senderId,
        sequence: record.sequence,
        messageType: event.messageType,
        body: event.body,
        replyTo: event.replyTo,
        assetIds: [...event.assetIds],
        attachments: event.attachments.map((item) => ({ ...item })),
        edited: false,
        deleted: false,
        reactions: [],
      });
      appliedEventIds.push(record.eventId);
      continue;
    }

    const target = messages.get(event.targetMessageId);
    if (!target) {
      rejectedEventIds.push(record.eventId);
      continue;
    }

    if (event.kind === "edit") {
      if (target.senderId !== record.senderId || target.deleted) {
        rejectedEventIds.push(record.eventId);
        continue;
      }
      target.body = event.body;
      target.edited = true;
      appliedEventIds.push(record.eventId);
      continue;
    }

    if (event.kind === "delete") {
      if (target.senderId !== record.senderId || target.deleted) {
        rejectedEventIds.push(record.eventId);
        continue;
      }
      target.deleted = true;
      target.body = null;
      target.replyTo = null;
      target.assetIds = [];
      target.attachments = [];
      appliedEventIds.push(record.eventId);
      continue;
    }

    if (event.kind === "reaction") {
      if (target.deleted) {
        rejectedEventIds.push(record.eventId);
        continue;
      }
      const reactions = target.reactions.map((reaction) => ({
        emoji: reaction.emoji,
        userIds: [...reaction.userIds],
      }));
      const existing = reactions.find((reaction) => reaction.emoji === event.emoji);

      if (event.active) {
        if (existing) {
          if (!existing.userIds.includes(record.senderId)) {
            existing.userIds.push(record.senderId);
            existing.userIds.sort();
          }
        } else {
          reactions.push({ emoji: event.emoji, userIds: [record.senderId] });
        }
      } else if (existing) {
        existing.userIds = existing.userIds.filter((id) => id !== record.senderId);
      }

      target.reactions = reactions
        .filter((reaction) => reaction.userIds.length > 0)
        .sort((left, right) => left.emoji.localeCompare(right.emoji));
      appliedEventIds.push(record.eventId);
    }
  }

  return {
    messages: [...messages.values()].sort(
      (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
    ),
    appliedEventIds,
    rejectedEventIds,
  };
}

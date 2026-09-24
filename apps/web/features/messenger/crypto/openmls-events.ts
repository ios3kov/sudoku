import type { EncryptedEventRecord } from "@sudoku/domain";
import { isEncryptedAttachmentMetadata } from "../attachment-metadata";
import type { E2eeEnvelope } from "../types";
import type { DecryptedMessage } from "./protocol-adapter";
import {
  envelopeBytes,
  utf8,
  utf8String,
} from "./openmls-state";

interface ApplicationDecryptor {
  decryptApplication(groupId: Uint8Array, ciphertext: Uint8Array): Uint8Array;
}

export function decryptApplicationEvent(
  provider: ApplicationDecryptor,
  conversationId: string,
  envelope: E2eeEnvelope,
): DecryptedMessage {
  if (envelope.kind !== "application") {
    throw new Error("Expected an MLS application envelope");
  }

  const plaintext = provider.decryptApplication(
    utf8(conversationId),
    envelopeBytes(envelope),
  );
  const decoded = JSON.parse(utf8String(plaintext)) as Record<string, unknown>;
  if (decoded.version !== 1 || typeof decoded.kind !== "string") {
    throw new Error("Invalid decrypted MLS application payload");
  }

  if (decoded.kind === "message") {
    if (
      !["text", "image", "file", "voice"].includes(String(decoded.messageType))
      || !(typeof decoded.body === "string" || decoded.body === null)
      || !(typeof decoded.replyTo === "string" || decoded.replyTo === null)
      || !Array.isArray(decoded.assetIds)
      || decoded.assetIds.some((item) => typeof item !== "string")
      || !Array.isArray(decoded.attachments)
    ) {
      throw new Error("Invalid decrypted MLS message event");
    }

    const attachments = decoded.attachments.map((item) => {
      if (!isEncryptedAttachmentMetadata(item)) {
        throw new Error("Invalid decrypted MLS message event");
      }
      return item;
    });
    if (
      decoded.messageType !== "voice"
      && attachments.some((item) => item.voice !== undefined)
    ) {
      throw new Error("Voice presentation metadata requires a voice message");
    }

    return {
      body: decoded.body,
      event: {
        kind: "message",
        messageType: decoded.messageType as "text" | "image" | "file" | "voice",
        body: decoded.body,
        replyTo: decoded.replyTo,
        assetIds: decoded.assetIds as string[],
        attachments,
      },
    };
  }

  if (decoded.kind === "edit") {
    if (typeof decoded.targetMessageId !== "string" || typeof decoded.body !== "string") {
      throw new Error("Invalid decrypted MLS edit event");
    }
    return {
      body: null,
      event: {
        kind: "edit",
        targetMessageId: decoded.targetMessageId,
        body: decoded.body,
      },
    };
  }

  if (decoded.kind === "reaction") {
    if (
      typeof decoded.targetMessageId !== "string"
      || typeof decoded.emoji !== "string"
      || typeof decoded.active !== "boolean"
    ) {
      throw new Error("Invalid decrypted MLS reaction event");
    }
    return {
      body: null,
      event: {
        kind: "reaction",
        targetMessageId: decoded.targetMessageId,
        emoji: decoded.emoji,
        active: decoded.active,
      },
    };
  }

  if (decoded.kind === "delete") {
    if (typeof decoded.targetMessageId !== "string") {
      throw new Error("Invalid decrypted MLS delete event");
    }
    return {
      body: null,
      event: {
        kind: "delete",
        targetMessageId: decoded.targetMessageId,
      },
    };
  }

  throw new Error("Unsupported decrypted MLS application event");
}

export function toDomainEvent(
  event: DecryptedMessage["event"],
): EncryptedEventRecord["event"] {
  if (event.kind !== "message") return event;
  return {
    ...event,
    assetIds: [...event.assetIds],
    attachments: event.attachments.map((item) => ({ ...item })),
  };
}

export function decryptedMessageFromDomainEvent(
  event: EncryptedEventRecord["event"],
): DecryptedMessage {
  if (event.kind === "message") {
    const attachments = event.attachments.map((item) => {
      if (!isEncryptedAttachmentMetadata(item)) {
        throw new Error("Invalid journaled encrypted attachment metadata");
      }
      return item;
    });
    return {
      body: event.body,
      event: {
        ...event,
        attachments,
      },
    };
  }
  return { body: null, event };
}

export function cloneDomainEvent(
  event: EncryptedEventRecord["event"],
): EncryptedEventRecord["event"] {
  return JSON.parse(JSON.stringify(event)) as EncryptedEventRecord["event"];
}

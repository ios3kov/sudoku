import type { Conversation } from "./types";

/** Merge only an acknowledged read watermark, never stale conversation data. */
export function applyReadReceipt(
  conversation: Conversation,
  currentUserId: string,
  readerId: string,
  sequence: number,
): Conversation {
  if (!Number.isSafeInteger(sequence) || sequence < 0) return conversation;
  const reader = conversation.members.find((member) => member.id === readerId);
  if (!reader) return conversation;
  const ownRead = readerId === currentUserId;
  if (sequence <= reader.last_read_sequence
    && (!ownRead || sequence <= conversation.last_read_sequence)) return conversation;
  return {
    ...conversation,
    last_read_sequence: ownRead
      ? Math.max(conversation.last_read_sequence, sequence) : conversation.last_read_sequence,
    members: conversation.members.map((member) => member.id === readerId
      ? { ...member, last_read_sequence: Math.max(member.last_read_sequence, sequence) }
      : member),
  };
}

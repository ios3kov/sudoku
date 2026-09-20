import type { Conversation } from "./types";

export const MAX_VOICE_SECONDS = 5 * 60;

const VOICE_MIME_CANDIDATES = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

export function conversationTitle(
  conversation: Conversation,
  currentUserId: string,
): string {
  if (conversation.title) return conversation.title;
  const other = conversation.members.find((member) => member.id !== currentUserId);
  return other?.display_name ?? "Conversation";
}

export function findSupportedVoiceMime(): string | undefined {
  return VOICE_MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime));
}

export function normalizeVoiceMime(value: string): string {
  return value.split(";", 1)[0];
}

export function voiceFileExtension(mimeType: string): "m4a" | "webm" {
  return mimeType === "audio/mp4" ? "m4a" : "webm";
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

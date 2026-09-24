import { MAX_VOICE_SECONDS } from "./chat-utils";
import type {
  EncryptedAttachmentMetadata,
  VoiceAttachmentPresentation,
} from "./types";

export const VOICE_WAVEFORM_TARGET_SAMPLES = 48;
export const MAX_VOICE_WAVEFORM_SAMPLES = 128;

export function isVoiceAttachmentPresentation(
  value: unknown,
): value is VoiceAttachmentPresentation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<VoiceAttachmentPresentation>;
  return (
    typeof item.durationMs === "number"
    && Number.isSafeInteger(item.durationMs)
    && item.durationMs > 0
    && item.durationMs <= MAX_VOICE_SECONDS * 1_000
    && Array.isArray(item.waveform)
    && item.waveform.length <= MAX_VOICE_WAVEFORM_SAMPLES
    && item.waveform.every(
      (sample) =>
        typeof sample === "number"
        && Number.isFinite(sample)
        && sample >= 0
        && sample <= 1,
    )
  );
}

export function isEncryptedAttachmentMetadata(
  value: unknown,
): value is EncryptedAttachmentMetadata {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EncryptedAttachmentMetadata>;
  return (
    item.version === 1
    && item.algorithm === "AES-256-GCM"
    && typeof item.assetId === "string"
    && typeof item.keyB64 === "string"
    && typeof item.nonceB64 === "string"
    && typeof item.originalName === "string"
    && typeof item.originalMime === "string"
    && typeof item.plaintextSize === "number"
    && Number.isSafeInteger(item.plaintextSize)
    && item.plaintextSize >= 0
    && typeof item.plaintextSha256Hex === "string"
    && /^[0-9a-f]{64}$/i.test(item.plaintextSha256Hex)
    && typeof item.ciphertextSha256Hex === "string"
    && /^[0-9a-f]{64}$/i.test(item.ciphertextSha256Hex)
    && (item.voice === undefined || isVoiceAttachmentPresentation(item.voice))
  );
}

export function normalizeVoiceWaveform(
  samples: readonly number[],
  targetSamples = VOICE_WAVEFORM_TARGET_SAMPLES,
): number[] {
  if (!Number.isInteger(targetSamples) || targetSamples < 1 || targetSamples > MAX_VOICE_WAVEFORM_SAMPLES) {
    throw new Error("Invalid waveform sample target");
  }
  if (samples.length === 0) return [];
  const clean = samples.map((sample) =>
    Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0
  );
  if (clean.length <= targetSamples) return clean;

  const result: number[] = [];
  for (let index = 0; index < targetSamples; index += 1) {
    const start = Math.floor(index * clean.length / targetSamples);
    const end = Math.max(start + 1, Math.floor((index + 1) * clean.length / targetSamples));
    let peak = 0;
    for (let offset = start; offset < end && offset < clean.length; offset += 1) {
      peak = Math.max(peak, clean[offset]);
    }
    result.push(peak);
  }
  return result;
}

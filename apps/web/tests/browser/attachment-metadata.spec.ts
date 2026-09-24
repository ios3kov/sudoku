import { expect, test } from "@playwright/test";
import {
  isEncryptedAttachmentMetadata,
  normalizeVoiceWaveform,
} from "../../features/messenger/attachment-metadata";

const base = {
  version: 1 as const,
  algorithm: "AES-256-GCM" as const,
  assetId: "asset",
  keyB64: "key",
  nonceB64: "nonce",
  originalName: "voice.webm",
  originalMime: "audio/webm",
  plaintextSize: 10,
  plaintextSha256Hex: "0".repeat(64),
  ciphertextSha256Hex: "1".repeat(64),
};

test("encrypted attachment metadata stays backward compatible and bounds voice presentation", () => {
  expect(isEncryptedAttachmentMetadata(base)).toBe(true);
  expect(isEncryptedAttachmentMetadata({
    ...base,
    voice: { durationMs: 4_200, waveform: [0, 0.25, 0.5, 1] },
  })).toBe(true);

  expect(isEncryptedAttachmentMetadata({
    ...base,
    voice: { durationMs: 0, waveform: [0.5] },
  })).toBe(false);
  expect(isEncryptedAttachmentMetadata({
    ...base,
    voice: { durationMs: 300_001, waveform: [0.5] },
  })).toBe(false);
  expect(isEncryptedAttachmentMetadata({
    ...base,
    voice: { durationMs: 1_000, waveform: [1.01] },
  })).toBe(false);
  expect(isEncryptedAttachmentMetadata({
    ...base,
    voice: { durationMs: 1_000, waveform: Array.from({ length: 129 }, () => 0.5) },
  })).toBe(false);
});

test("waveform normalization clamps invalid amplitudes and bounds sample count", () => {
  expect(normalizeVoiceWaveform([-1, 0.25, Number.NaN, 2], 4)).toEqual([0, 0.25, 0, 1]);
  const reduced = normalizeVoiceWaveform(Array.from({ length: 480 }, (_, index) => index / 479), 48);
  expect(reduced).toHaveLength(48);
  expect(reduced.every((sample) => sample >= 0 && sample <= 1)).toBe(true);
  expect(() => normalizeVoiceWaveform([0.5], 129)).toThrow();
});

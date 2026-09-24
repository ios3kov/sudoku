import { MAX_VOICE_SECONDS } from "./chat-utils";
import {
  normalizeVoiceWaveform,
  VOICE_WAVEFORM_TARGET_SAMPLES,
} from "./attachment-metadata";
import type { VoiceAttachmentPresentation } from "./types";

function boundedDurationMs(value: number): number {
  if (!Number.isFinite(value)) return 1_000;
  return Math.max(1, Math.min(MAX_VOICE_SECONDS * 1_000, Math.round(value)));
}

function waveformFromAudioBuffer(buffer: AudioBuffer): number[] {
  const frames = buffer.length;
  if (frames < 1 || buffer.numberOfChannels < 1) return [];

  const raw: number[] = [];
  for (let bucket = 0; bucket < VOICE_WAVEFORM_TARGET_SAMPLES; bucket += 1) {
    const start = Math.floor(bucket * frames / VOICE_WAVEFORM_TARGET_SAMPLES);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * frames / VOICE_WAVEFORM_TARGET_SAMPLES));
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      const stride = Math.max(1, Math.floor((end - start) / 256));
      for (let index = start; index < end && index < data.length; index += stride) {
        peak = Math.max(peak, Math.abs(data[index]));
      }
      if (end > start && end - 1 < data.length) {
        peak = Math.max(peak, Math.abs(data[end - 1]));
      }
    }
    raw.push(peak);
  }

  const maximum = Math.max(...raw);
  if (maximum <= 0) return raw.map(() => 0);
  return normalizeVoiceWaveform(raw.map((sample) => sample / maximum));
}

export async function analyzeVoiceBlob(
  blob: Blob,
  fallbackDurationMs: number,
): Promise<VoiceAttachmentPresentation> {
  const fallback: VoiceAttachmentPresentation = {
    durationMs: boundedDurationMs(fallbackDurationMs),
    waveform: [],
  };

  if (typeof AudioContext === "undefined") return fallback;

  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    const bytes = await blob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    return {
      durationMs: boundedDurationMs(buffer.duration * 1_000),
      waveform: waveformFromAudioBuffer(buffer),
    };
  } catch {
    return fallback;
  } finally {
    if (context) void context.close().catch(() => undefined);
  }
}

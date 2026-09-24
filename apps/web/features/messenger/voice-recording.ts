import { findSupportedVoiceMime } from "./chat-utils";

// A speech-oriented target, not a promise about browser encoder output size.
export const VOICE_BITS_PER_SECOND = 32_000;

export function createVoiceRecorder(stream: MediaStream, mimeType = findSupportedVoiceMime()): MediaRecorder {
  const format: MediaRecorderOptions = mimeType ? { mimeType } : {};
  try {
    return new MediaRecorder(stream, { ...format, audioBitsPerSecond: VOICE_BITS_PER_SECOND });
  } catch (error) {
    // Some platform encoders reject an explicit bitrate. Reuse the same stream
    // and supported format; never reacquire the microphone or retry other errors.
    if (!(error instanceof DOMException) || error.name !== "NotSupportedError") throw error;
    return new MediaRecorder(stream, format);
  }
}

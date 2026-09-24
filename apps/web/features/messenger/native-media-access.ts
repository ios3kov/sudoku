"use client";

export const NATIVE_MEDIA_READY_EVENT = "sudoku:native-media-ready";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

type NativePickedFilePayload = {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
};

type NativeMediaBridge = {
  pickAttachment: () => Promise<NativePickedFilePayload>;
};

declare global {
  interface Window {
    SudokuNativeMedia?: NativeMediaBridge;
  }
}

export function nativeMediaAvailable(): boolean {
  return typeof window !== "undefined"
    && typeof window.SudokuNativeMedia?.pickAttachment === "function";
}

export async function pickNativeAttachment(): Promise<File> {
  if (!nativeMediaAvailable()) {
    throw new Error("Native attachment picker is unavailable");
  }

  const payload = await window.SudokuNativeMedia!.pickAttachment();
  if (
    !payload
    || typeof payload.name !== "string"
    || typeof payload.mimeType !== "string"
    || typeof payload.size !== "number"
    || !Number.isSafeInteger(payload.size)
    || payload.size < 0
    || payload.size > MAX_ATTACHMENT_BYTES
    || typeof payload.base64 !== "string"
    || payload.base64.length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 8
    || !ALLOWED_MIME_TYPES.has(payload.mimeType)
  ) {
    throw new Error("Native attachment picker returned invalid data");
  }

  const binary = atob(payload.base64);
  if (binary.length !== payload.size) {
    throw new Error("Native attachment size mismatch");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const cleanName = payload.name
    .replace(/[\\/]/g, "-")
    .trim()
    .slice(0, 180) || "attachment";

  return new File([bytes], cleanName, { type: payload.mimeType });
}

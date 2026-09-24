export type PhotoQuality = "standard" | "original";

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 2048;
const MAX_PIXELS = 50_000_000;

async function checkDecodeSize(file: File) {
  // Inspect bounded JPEG headers before allocating a potentially huge bitmap.
  const bytes = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if (frames.has(marker) && length >= 8) {
        const height = bytes[offset + 3] * 256 + bytes[offset + 4];
        const width = bytes[offset + 5] * 256 + bytes[offset + 6];
        if (width > 0 && height > 0 && width * height <= MAX_PIXELS) return;
        throw new Error("Photo is too large to prepare safely. Select Original instead.");
      }
      offset += length;
    }
  }
  throw new Error("Unable to prepare photo. Select it again to send Original.");
}

// Other formats may contain transparency or animation; preserve their bytes.
export function canPreparePhoto(file: File): boolean {
  return file.type === "image/jpeg";
}

/** Local-only preparation. Call before generating keys or uploading ciphertext. */
export async function preparePhoto(file: File, quality: PhotoQuality): Promise<File> {
  if (file.size === 0 || file.size > MAX_INPUT_BYTES) {
    throw new Error("File must be 25 MB or smaller");
  }
  if (quality === "original" || !canPreparePhoto(file)) return file;
  await checkDecodeSize(file);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Unable to prepare photo. Select it again to send Original.");
  }
  const canvas = document.createElement("canvas");
  try {
    const ratio = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo preparation is unavailable. Select Original instead.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.type !== "image/jpeg") {
      throw new Error("Unable to prepare photo. Select Original instead.");
    }
    // Re-encoding must never increase storage or transfer size.
    if (blob.size >= file.size) return file;
    return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

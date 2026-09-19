import type {
  AssetSummary,
  EncryptedAttachmentMetadata,
} from "./types";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const E2EE_MIME = "application/octet-stream";

interface UploadIntent {
  asset_id: string;
  upload_url: string;
  headers: Record<string, string>;
  expires_in: number;
}

interface AssetResponse extends AssetSummary {
  sha256_hex: string;
  created_at: string;
}

export interface EncryptedAssetUpload {
  asset: AssetResponse;
  metadata: EncryptedAttachmentMetadata;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(buffer),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function ownedBytes(value: Uint8Array): Uint8Array {
  const output = new Uint8Array(value.byteLength);
  output.set(value);
  return output;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = ownedBytes(bytes);
  return toHex(await crypto.subtle.digest("SHA-256", owned));
}

function putBlob(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress: (value: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(blob);
  });
}

export async function uploadAsset(
  file: File,
  onProgress: (value: number) => void,
): Promise<AssetResponse> {
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    throw new Error("File must be 25 MB or smaller");
  }
  const bytes = await file.arrayBuffer();
  const sha256 = toHex(await crypto.subtle.digest("SHA-256", bytes));

  const intentResponse = await fetch("/v1/assets/upload-intents", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      mime_type: file.type || E2EE_MIME,
      size_bytes: file.size,
      sha256_hex: sha256,
    }),
  });
  if (!intentResponse.ok) {
    throw new Error(
      intentResponse.status === 415
        ? "Unsupported file type"
        : "Unable to create upload",
    );
  }
  const intent = (await intentResponse.json()) as UploadIntent;

  await putBlob(intent.upload_url, file, intent.headers, onProgress);
  onProgress(100);

  const completeResponse = await fetch(`/v1/assets/${intent.asset_id}/complete`, {
    method: "POST",
    credentials: "include",
  });
  if (!completeResponse.ok) {
    throw new Error("Uploaded file failed verification");
  }
  return (await completeResponse.json()) as AssetResponse;
}

export async function uploadEncryptedAsset(
  file: File,
  onProgress: (value: number) => void,
): Promise<EncryptedAssetUpload> {
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    throw new Error("File must be 25 MB or smaller");
  }

  const plaintext = new Uint8Array(await file.arrayBuffer());
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    ownedBytes(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedBytes(nonce) },
    key,
    ownedBytes(plaintext),
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);
  const plaintextSha256Hex = await sha256Hex(plaintext);
  const ciphertextSha256Hex = await sha256Hex(ciphertext);

  const intentResponse = await fetch("/v1/assets/e2ee-upload-intents", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      size_bytes: ciphertext.byteLength,
      sha256_hex: ciphertextSha256Hex,
    }),
  });
  if (!intentResponse.ok) {
    throw new Error("Unable to create encrypted upload");
  }
  const intent = (await intentResponse.json()) as UploadIntent;
  const ciphertextCopy = ownedBytes(ciphertext);
  const ciphertextBlob = new Blob([ciphertextCopy.buffer], { type: E2EE_MIME });

  await putBlob(intent.upload_url, ciphertextBlob, intent.headers, onProgress);
  onProgress(100);

  const completeResponse = await fetch(`/v1/assets/${intent.asset_id}/complete`, {
    method: "POST",
    credentials: "include",
  });
  if (!completeResponse.ok) {
    throw new Error("Encrypted upload failed verification");
  }
  const asset = (await completeResponse.json()) as AssetResponse;
  if (!asset.e2ee_ciphertext) {
    throw new Error("Server did not mark attachment as E2EE ciphertext");
  }

  return {
    asset,
    metadata: {
      version: 1,
      algorithm: "AES-256-GCM",
      assetId: asset.id,
      keyB64: bytesToBase64(keyBytes),
      nonceB64: bytesToBase64(nonce),
      originalName: file.name,
      originalMime: file.type || E2EE_MIME,
      plaintextSize: file.size,
      plaintextSha256Hex,
      ciphertextSha256Hex,
    },
  };
}

export async function downloadEncryptedAsset(
  asset: AssetSummary,
  metadata: EncryptedAttachmentMetadata,
): Promise<File> {
  if (!asset.e2ee_ciphertext || asset.id !== metadata.assetId) {
    throw new Error("Encrypted attachment metadata does not match asset");
  }
  if (metadata.version !== 1 || metadata.algorithm !== "AES-256-GCM") {
    throw new Error("Unsupported encrypted attachment format");
  }

  const response = await fetch(asset.content_url, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Unable to download encrypted attachment");

  const ciphertext = new Uint8Array(await response.arrayBuffer());
  if (await sha256Hex(ciphertext) !== metadata.ciphertextSha256Hex.toLowerCase()) {
    throw new Error("Encrypted attachment ciphertext digest mismatch");
  }

  const keyBytes = base64ToBytes(metadata.keyB64);
  const nonce = base64ToBytes(metadata.nonceB64);
  if (keyBytes.byteLength !== 32 || nonce.byteLength !== 12) {
    throw new Error("Invalid encrypted attachment key material");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    ownedBytes(keyBytes),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  let plaintextBuffer: ArrayBuffer;
  try {
    plaintextBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ownedBytes(nonce) },
      key,
      ownedBytes(ciphertext),
    );
  } catch {
    throw new Error("Encrypted attachment authentication failed");
  }

  const plaintext = new Uint8Array(plaintextBuffer);
  if (
    plaintext.byteLength !== metadata.plaintextSize
    || await sha256Hex(plaintext) !== metadata.plaintextSha256Hex.toLowerCase()
  ) {
    throw new Error("Encrypted attachment plaintext integrity check failed");
  }

  const plaintextCopy = ownedBytes(plaintext);
  return new File(
    [plaintextCopy.buffer],
    metadata.originalName,
    { type: metadata.originalMime || E2EE_MIME },
  );
}

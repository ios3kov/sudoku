import type { AssetSummary } from "./types";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

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

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function putFile(url: string, file: File, headers: Record<string, string>, onProgress: (value: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}

export async function uploadAsset(file: File, onProgress: (value: number) => void): Promise<AssetResponse> {
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error("File must be 25 MB or smaller");
  const bytes = await file.arrayBuffer();
  const sha256 = toHex(await crypto.subtle.digest("SHA-256", bytes));

  const intentResponse = await fetch("/v1/assets/upload-intents", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      sha256_hex: sha256,
    }),
  });
  if (!intentResponse.ok) throw new Error(intentResponse.status === 415 ? "Unsupported file type" : "Unable to create upload");
  const intent = (await intentResponse.json()) as UploadIntent;

  await putFile(intent.upload_url, file, intent.headers, onProgress);
  onProgress(100);

  const completeResponse = await fetch(`/v1/assets/${intent.asset_id}/complete`, {
    method: "POST",
    credentials: "include",
  });
  if (!completeResponse.ok) throw new Error("Uploaded file failed verification");
  return (await completeResponse.json()) as AssetResponse;
}

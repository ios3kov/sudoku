// Test-only transport stand-in. This tests resource ownership, not cryptography.
import type { AssetSummary, EncryptedAttachmentMetadata } from "../../../features/messenger/types";
export const io = {
  downloads: [] as Array<{ resolve: (file: File) => void; reject: (error: Error) => void; signal?: AbortSignal }>,
  uploads: 0,
  uploadedFiles: [] as File[],
};
export function downloadEncryptedAsset(_asset: AssetSummary, _metadata: EncryptedAttachmentMetadata, signal?: AbortSignal): Promise<File> {
  // Deliberately resolve even after abort: UI must also reject stale completion.
  return new Promise((resolve, reject) => { io.downloads.push({ resolve, reject, signal }); });
}
export async function uploadEncryptedAsset(file: File) {
  io.uploads += 1;
  io.uploadedFiles.push(file);
  return {asset: {id: "asset", e2ee_ciphertext: true}, metadata: {}};
}
export async function uploadAsset() {
  io.uploads += 1;
  return {id: "asset"};
}

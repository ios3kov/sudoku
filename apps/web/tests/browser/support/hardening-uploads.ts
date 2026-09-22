import { controls, deferred } from "./hardening-controls";
import type { EncryptedAssetUpload } from "../../../features/messenger/uploads";

export async function uploadEncryptedAsset(): Promise<EncryptedAssetUpload> {
  const gate = deferred<unknown>();
  controls.uploads.push(gate);
  return await gate.promise as EncryptedAssetUpload;
}
export async function downloadEncryptedAsset(): Promise<File> {
  const gate = deferred<File>();
  controls.decryptions.push(gate);
  return gate.promise;
}

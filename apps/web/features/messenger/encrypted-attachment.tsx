"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import type { EncryptedAttachmentMetadata } from "./types";
import { downloadEncryptedAsset } from "./uploads";

export function isEncryptedAttachmentMetadata(
  value: Record<string, unknown>,
): value is EncryptedAttachmentMetadata {
  return (
    value.version === 1
    && value.algorithm === "AES-256-GCM"
    && typeof value.assetId === "string"
    && typeof value.keyB64 === "string"
    && typeof value.nonceB64 === "string"
    && typeof value.originalName === "string"
    && typeof value.originalMime === "string"
    && typeof value.plaintextSize === "number"
    && Number.isSafeInteger(value.plaintextSize)
    && value.plaintextSize >= 0
    && typeof value.plaintextSha256Hex === "string"
    && /^[0-9a-f]{64}$/i.test(value.plaintextSha256Hex)
    && typeof value.ciphertextSha256Hex === "string"
    && /^[0-9a-f]{64}$/i.test(value.ciphertextSha256Hex)
  );
}

export function EncryptedAttachment({
  metadata,
  messageType,
}: {
  metadata: EncryptedAttachmentMetadata;
  messageType: "image" | "file" | "voice";
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [decryptedFile, setDecryptedFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const objectUrlRef = useRef<string | null>(null);

  const decrypt = useCallback(async (): Promise<File> => {
    if (decryptedFile) return decryptedFile;
    setState("loading");
    try {
      const asset = await messengerApi.asset(metadata.assetId);
      const file = await downloadEncryptedAsset(asset, metadata);
      const url = URL.createObjectURL(file);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url;
      setObjectUrl(url);
      setDecryptedFile(file);
      setState("ready");
      return file;
    } catch (error) {
      setState("error");
      throw error;
    }
  }, [decryptedFile, metadata]);

  useEffect(() => {
    if (messageType === "image" || messageType === "voice") {
      void decrypt().catch(() => undefined);
    }
  }, [decrypt, messageType]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  async function download() {
    try {
      const file = await decrypt();
      const url = objectUrlRef.current;
      if (!url) throw new Error("Decrypted attachment URL is unavailable");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.rel = "noopener";
      anchor.click();
    } catch {
      // Visible state remains generic by design.
    }
  }

  if (state === "error") {
    return <div className="file-attachment"><strong>Encrypted attachment unavailable</strong></div>;
  }

  if (messageType === "image") {
    return (
      <button
        className="image-attachment"
        type="button"
        onClick={() => void download()}
        disabled={state === "loading"}
        aria-label={`Open encrypted image ${metadata.originalName}`}
      >
        {objectUrl ? (
          <img src={objectUrl} alt={metadata.originalName} loading="lazy" />
        ) : (
          <span>{state === "loading" ? "Decrypting image…" : "Load encrypted image"}</span>
        )}
      </button>
    );
  }

  if (messageType === "voice") {
    return (
      <div className="voice-attachment">
        {objectUrl ? (
          <audio controls preload="metadata" src={objectUrl} />
        ) : (
          <button type="button" onClick={() => void decrypt()} disabled={state === "loading"}>
            {state === "loading" ? "Decrypting voice…" : "Load encrypted voice"}
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      className="file-attachment"
      type="button"
      onClick={() => void download()}
      disabled={state === "loading"}
    >
      <span>{state === "loading" ? "Decrypting…" : "File"}</span>
      <strong>{metadata.originalName}</strong>
      <small>{formatBytes(metadata.plaintextSize)}</small>
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

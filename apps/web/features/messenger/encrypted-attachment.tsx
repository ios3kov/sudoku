"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import type { EncryptedAttachmentMetadata } from "./types";
import { downloadEncryptedAsset } from "./uploads";
import { formatBytes } from "./chat-utils";

export function isEncryptedAttachmentMetadata(
  value: unknown,
): value is EncryptedAttachmentMetadata {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.version === 1
    && item.algorithm === "AES-256-GCM"
    && typeof item.assetId === "string"
    && typeof item.keyB64 === "string"
    && typeof item.nonceB64 === "string"
    && typeof item.originalName === "string"
    && typeof item.originalMime === "string"
    && typeof item.plaintextSize === "number"
    && Number.isSafeInteger(item.plaintextSize)
    && item.plaintextSize >= 0
    && typeof item.plaintextSha256Hex === "string"
    && /^[0-9a-f]{64}$/i.test(item.plaintextSha256Hex)
    && typeof item.ciphertextSha256Hex === "string"
    && /^[0-9a-f]{64}$/i.test(item.ciphertextSha256Hex)
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
  const imageButtonRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(true);
  const decryptGenerationRef = useRef(0);

  const releaseDecrypted = useCallback(() => {
    decryptGenerationRef.current += 1;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setObjectUrl(null);
    setDecryptedFile(null);
    setState("idle");
  }, []);

  const decrypt = useCallback(async (): Promise<File> => {
    if (decryptedFile) return decryptedFile;
    const generation = ++decryptGenerationRef.current;
    setState("loading");
    try {
      const asset = await messengerApi.asset(metadata.assetId);
      const file = await downloadEncryptedAsset(asset, metadata);
      if (!mountedRef.current || generation !== decryptGenerationRef.current) {
        throw new Error("Encrypted attachment view is no longer active");
      }
      const url = URL.createObjectURL(file);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url;
      setObjectUrl(url);
      setDecryptedFile(file);
      setState("ready");
      return file;
    } catch (error) {
      if (mountedRef.current && generation === decryptGenerationRef.current) {
        setState("error");
      }
      throw error;
    }
  }, [decryptedFile, metadata]);

  useEffect(() => {
    if (messageType !== "image") return;
    const node = imageButtonRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      if (state === "idle") void decrypt().catch(() => undefined);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const nearViewport = entries.some((entry) => entry.isIntersecting);
        if (nearViewport && state === "idle") {
          void decrypt().catch(() => undefined);
        } else if (!nearViewport && state === "ready") {
          releaseDecrypted();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [decrypt, messageType, releaseDecrypted, state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      decryptGenerationRef.current += 1;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
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
      if (messageType === "file") {
        window.setTimeout(releaseDecrypted, 0);
      }
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
        ref={imageButtonRef}
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

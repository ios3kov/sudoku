"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { messengerApi } from "./api";
import type { EncryptedAttachmentMetadata } from "./types";
import { downloadEncryptedAsset } from "./uploads";
import { formatBytes } from "./chat-utils";
import { VoiceMessagePlayback } from "./voice-waveform";

export { isEncryptedAttachmentMetadata } from "./attachment-metadata";
export function EncryptedAttachment({
  metadata,
  messageType,
}: {
  metadata: EncryptedAttachmentMetadata;
  messageType: "image" | "file" | "voice";
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const objectUrlRef = useRef<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const imageButtonRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const requestRef = useRef<{controller: AbortController; promise: Promise<File>} | null>(null);
  const releaseTimerRef = useRef<number | null>(null);

  const releaseDecrypted = useCallback(() => {
    generationRef.current += 1;
    requestRef.current?.controller.abort();
    requestRef.current = null;
    if (releaseTimerRef.current !== null) window.clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = null;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    fileRef.current = null;
    if (mountedRef.current) { setObjectUrl(null); setState("idle"); }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; releaseDecrypted(); };
  }, [releaseDecrypted]);

  const decrypt = useCallback((): Promise<File> => {
    if (!mountedRef.current) return Promise.reject(new DOMException("Attachment closed", "AbortError"));
    if (fileRef.current) return Promise.resolve(fileRef.current);
    if (requestRef.current) return requestRef.current.promise;
    const controller = new AbortController();
    const generation = ++generationRef.current;
    const isCurrent = () => mountedRef.current && generationRef.current === generation && !controller.signal.aborted;
    setState("loading");
    const promise = Promise.resolve().then(async () => {
      const asset = await messengerApi.asset(metadata.assetId, controller.signal);
      controller.signal.throwIfAborted();
      const file = await downloadEncryptedAsset(asset, metadata, controller.signal);
      // Aborting fetch cannot cancel WebCrypto or an already-completed response.
      if (!isCurrent()) throw new DOMException("Attachment closed", "AbortError");
      const url = URL.createObjectURL(file);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url;
      fileRef.current = file;
      setObjectUrl(url);
      setState("ready");
      return file;
    }).catch((error: unknown) => {
      if (isCurrent()) setState("error");
      throw error;
    }).finally(() => {
      if (requestRef.current?.controller === controller) requestRef.current = null;
    });
    requestRef.current = {controller, promise};
    return promise;
  }, [metadata]);

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
        } else if (!nearViewport && (state === "ready" || state === "loading")) {
          releaseDecrypted();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [decrypt, messageType, releaseDecrypted, state]);

  async function download() {
    try {
      const file = await decrypt();
      if (!mountedRef.current || fileRef.current !== file) return;
      const url = objectUrlRef.current;
      if (!url) throw new Error("Decrypted attachment URL is unavailable");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.rel = "noopener";
      anchor.click();
      if (messageType === "file") {
        if (releaseTimerRef.current !== null) window.clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = window.setTimeout(() => {
          if (objectUrlRef.current === url) releaseDecrypted();
        }, 0);
      }
    } catch {
      // Visible state remains generic by design.
    }
  }

  if (state === "error") {
    return <div className="file-attachment" role="alert">
      <strong>Encrypted attachment unavailable</strong>
      <button type="button" aria-label="Retry encrypted attachment" onClick={() => void decrypt().catch(() => undefined)}>Retry</button>
    </div>;
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
        <VoiceMessagePlayback
          source={objectUrl}
          presentation={metadata.voice}
          loading={state === "loading"}
          onLoad={async () => {
            await decrypt();
          }}
        />
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

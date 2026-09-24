"use client";

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    SudokuNativeVideo?: { play(payload: { id: string; mimeType: string; base64: string }): Promise<unknown>; stop(id: string): Promise<unknown> };
  }
}

export function VideoAttachment({ name, onLoad, onRelease }: {
  name: string;
  onLoad: () => Promise<File>;
  onRelease: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const url = useRef<string | null>(null);
  const reader = useRef<FileReader | null>(null);
  const generation = useRef(0);
  const nativeRequest = useRef<string | null>(null);
  const active = useRef(false);
  const release = useRef(onRelease);
  useEffect(() => { release.current = onRelease; }, [onRelease]);

  const dispose = useCallback(() => {
    generation.current += 1;
    if (nativeRequest.current) void window.SudokuNativeVideo?.stop(nativeRequest.current).catch(() => undefined);
    nativeRequest.current = null;
    reader.current?.abort(); reader.current = null;
    video.current?.pause();
    video.current?.removeAttribute("src");
    video.current?.load();
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    release.current();
  }, []);

  const close = useCallback(() => {
    dispose();
    dialog.current?.close();
    if (active.current) {
      setSource(null); setBusy(false);
      trigger.current?.focus();
    }
  }, [dispose]);

  useEffect(() => {
    active.current = true;
    const conceal = () => { if (document.visibilityState === "hidden") close(); };
    document.addEventListener("visibilitychange", conceal);
    window.addEventListener("pagehide", close);
    return () => {
      active.current = false;
      document.removeEventListener("visibilitychange", conceal);
      window.removeEventListener("pagehide", close);
      dispose();
    };
  }, [close, dispose]);

  useEffect(() => {
    if (source) dialog.current?.showModal();
  }, [source]);

  async function open() {
    if (busy) return;
    setBusy(true); setError(null);
    const current = ++generation.current;
    try {
      const file = await onLoad();
      if (!active.current || current !== generation.current) return;
      if (file.size < 1 || file.size > 25 * 1024 * 1024 || !["video/mp4", "video/quicktime", "video/webm"].includes(file.type)) {
        throw new Error("Unsupported video");
      }
      const native = window.SudokuNativeVideo;
      if (native) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const currentReader = new FileReader();
          reader.current = currentReader;
          currentReader.onload = () => resolve(String(currentReader.result).split(",", 2)[1]);
          currentReader.onerror = () => reject(new Error("Unable to read video"));
          currentReader.onabort = () => reject(new DOMException("Closed", "AbortError"));
          currentReader.readAsDataURL(file);
        });
        reader.current = null;
        if (!active.current || current !== generation.current) return;
        const id = crypto.randomUUID();
        nativeRequest.current = id;
        await native.play({ id, mimeType: file.type, base64 });
        if (active.current && current === generation.current) close();
      } else {
        url.current = URL.createObjectURL(file);
        setSource(url.current);
      }
    } catch {
      if (active.current && current === generation.current) {
        close();
        setError("This video cannot be played on this device.");
      }
    } finally {
      if (active.current && current === generation.current) setBusy(false);
    }
  }

  return <div className="video-attachment">
    <button ref={trigger} type="button" className="file-attachment" disabled={busy} onClick={() => void open()}>
      <span>{busy ? "Opening video…" : "Play video"}</span><strong>{name}</strong>
    </button>
    {error ? <p role="alert">{error}</p> : null}
    <dialog ref={dialog} className="video-viewer" aria-label={`Video: ${name}`} onCancel={event => { event.preventDefault(); close(); }}>
      <button type="button" autoFocus onClick={close}>Close video</button>
      {source ? <video ref={video} src={source} controls playsInline preload="metadata" disablePictureInPicture disableRemotePlayback
        onError={() => { close(); setError("This video cannot be played on this device."); }} /> : null}
    </dialog>
  </div>;
}

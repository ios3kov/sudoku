"use client";

import { useEffect, useRef, useState } from "react";
import { accessEpoch, currentUnlockToken, privateFetch } from "./device-access";
import { formatBytes } from "./chat-utils";
import type { AssetSummary } from "./types";

export function ProtectedAttachment({ asset, voice }: { asset: AssetSummary; voice: boolean }) {
  // Preserve native streaming/navigation on sessions without a device PIN.
  if (!currentUnlockToken()) return <Attachment asset={asset} voice={voice} url={asset.content_url} />;
  return <PinAttachment asset={asset} voice={voice} />;
}

function Attachment({ asset, voice, url }: { asset: AssetSummary; voice: boolean; url: string }) {
  if (asset.mime_type.startsWith("image/")) return <a className="image-attachment" href={url} target="_blank" rel="noreferrer">
    <img src={url} alt={asset.filename} loading="lazy" />
  </a>;
  if (voice && asset.mime_type.startsWith("audio/")) return <div className="voice-attachment"><audio controls preload="metadata" src={url} /></div>;
  return <a className="file-attachment" href={url} download={url.startsWith("blob:") ? asset.filename : undefined} target="_blank" rel="noreferrer">
    <span>File</span><strong>{asset.filename}</strong><small>{formatBytes(asset.size_bytes)}</small>
  </a>;
}

function PinAttachment({ asset, voice }: { asset: AssetSummary; voice: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const preview = asset.mime_type.startsWith("image/") || (voice && asset.mime_type.startsWith("audio/"));

  useEffect(() => {
    if (!preview || !host.current) return;
    if (!("IntersectionObserver" in window)) { setRequested(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setRequested(true); observer.disconnect(); }
    }, { rootMargin: "100px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [preview]);

  useEffect(() => {
    if (!requested) return;
    let alive = true;
    let objectUrl: string | null = null;
    const started = accessEpoch();
    const controller = new AbortController();
    setError(false);
    void (async () => {
      if (asset.size_bytes > 25 * 1024 * 1024 || asset.size_bytes < 1) throw new Error("Invalid attachment size");
      const response = await privateFetch(`/v1/assets/${asset.id}/content`, { credentials: "include", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Attachment unavailable");
      const blob = await response.blob();
      if (!alive || controller.signal.aborted || started !== accessEpoch()) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })().catch(() => { if (alive && started === accessEpoch()) setError(true); });
    return () => { alive = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [asset.id, asset.size_bytes, requested, retry]);

  return <div ref={host}>
    {url ? <Attachment asset={asset} voice={voice} url={url} /> : error ?
      <button type="button" onClick={() => setRetry((v) => v + 1)}>Retry attachment</button> : requested ?
      <span role="status">Loading attachment…</span> :
      <button type="button" onClick={() => setRequested(true)}>Open {asset.filename} · {formatBytes(asset.size_bytes)}</button>}
  </div>;
}

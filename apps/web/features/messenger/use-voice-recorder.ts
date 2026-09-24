"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_VOICE_SECONDS, findSupportedVoiceMime, normalizeVoiceMime } from "./chat-utils";

type RecordingSession = {
  cancelled: boolean;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  elapsedSeconds: number;
  tick: number | null;
  deadline: number | null;
};

/** Release every resource, including a track acquired after its view vanished. */
function disposeSession(session: RecordingSession) {
  session.cancelled = true;
  if (session.tick !== null) window.clearInterval(session.tick);
  if (session.deadline !== null) window.clearTimeout(session.deadline);
  session.tick = session.deadline = null;
  const recorder = session.recorder;
  if (recorder) {
    // An error/teardown must not trigger the normal upload-on-stop callback.
    recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
    try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* Release tracks regardless. */ }
  }
  session.stream?.getTracks().forEach((track) => track.stop());
  session.stream = null;
  session.recorder = null;
  session.chunks = [];
}

export function useVoiceRecorder({ onReady, onError }: {
  onReady: (chunks: Blob[], mimeType: string, fallbackDurationMs: number) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording">("idle");
  const [seconds, setSeconds] = useState(0);
  const active = useRef<RecordingSession | null>(null);
  const mounted = useRef(false);
  const callbacks = useRef({ onReady, onError });
  useEffect(() => { callbacks.current = { onReady, onError }; }, [onReady, onError]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (active.current) disposeSession(active.current);
      active.current = null;
    };
  }, []);

  const toggle = useCallback(async () => {
    const current = active.current;
    if (current) {
      // Synchronous session ownership also prevents double-click acquisition.
      if (current.recorder?.state === "recording") current.recorder.stop();
      return;
    }
    if (!mounted.current) return;
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      callbacks.current.onError("Voice recording is not supported on this device");
      return;
    }
    const session: RecordingSession = {cancelled: false, stream: null, recorder: null, chunks: [], elapsedSeconds: 0, tick: null, deadline: null};
    active.current = session;
    setPhase("requesting");
    setSeconds(0);
    const isCurrent = () => mounted.current && active.current === session && !session.cancelled;
    const finish = () => {
      const wasActive = active.current === session;
      disposeSession(session);
      if (wasActive) active.current = null;
      if (wasActive && mounted.current) setPhase("idle");
    };
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({audio: true});
      // getUserMedia has no abort API and can resolve long after unmount.
      if (!isCurrent()) { disposeSession(session); return; }
      const mime = findSupportedVoiceMime();
      const recorder = mime ? new MediaRecorder(session.stream, {mimeType: mime}) : new MediaRecorder(session.stream);
      session.recorder = recorder;
      const baseMime = normalizeVoiceMime(recorder.mimeType || mime || "");
      if (!baseMime || !["audio/mp4", "audio/webm"].includes(baseMime)) {
        finish();
        callbacks.current.onError("This browser records an unsupported audio format");
        return;
      }
      recorder.ondataavailable = (event) => { if (isCurrent() && event.data.size > 0) session.chunks.push(event.data); };
      recorder.onerror = () => {
        if (!isCurrent()) return;
        finish();
        callbacks.current.onError("Voice recording failed");
      };
      recorder.onstop = () => {
        if (!isCurrent()) return;
        const chunks = [...session.chunks];
        const fallbackDurationMs = Math.max(
          1_000,
          Math.min(MAX_VOICE_SECONDS * 1_000, session.elapsedSeconds * 1_000),
        );
        finish();
        if (chunks.length > 0) {
          void callbacks.current.onReady(chunks, baseMime, fallbackDurationMs).catch(() => {
            if (mounted.current) callbacks.current.onError("Voice note failed");
          });
        }
      };
      recorder.start(250);
      setPhase("recording");
      session.tick = window.setInterval(() => {
        if (!isCurrent()) return;
        session.elapsedSeconds = Math.min(MAX_VOICE_SECONDS, session.elapsedSeconds + 1);
        setSeconds(session.elapsedSeconds);
      }, 1_000);
      session.deadline = window.setTimeout(() => { if (isCurrent() && recorder.state === "recording") recorder.stop(); }, MAX_VOICE_SECONDS * 1_000);
    } catch {
      const report = isCurrent();
      const acquired = session.stream !== null;
      finish();
      if (report) callbacks.current.onError(acquired ? "Voice recording failed" : "Microphone permission is required for voice notes");
    }
  }, []);

  return {recording: phase === "recording", requesting: phase === "requesting", seconds, toggle};
}

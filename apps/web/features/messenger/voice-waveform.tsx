"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "./chat-utils";
import type { VoiceAttachmentPresentation } from "./types";

const FALLBACK_BARS = Array.from({ length: 32 }, () => 0.35);

export function VoiceWaveform({
  waveform,
  progress,
  onSeek,
  disabled = false,
  label = "Voice playback position",
}: {
  waveform: readonly number[];
  progress: number;
  onSeek: (progress: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const bars = waveform.length > 0 ? waveform : FALLBACK_BARS;
  const boundedProgress = Math.max(0, Math.min(1, progress));

  return (
    <div className={`voice-waveform ${disabled ? "is-disabled" : ""}`}>
      <div className="voice-waveform-bars" aria-hidden="true">
        {bars.map((sample, index) => {
          const height = 18 + Math.max(0, Math.min(1, sample)) * 82;
          const played = (index + 0.5) / bars.length <= boundedProgress;
          return (
            <span
              className={played ? "is-played" : undefined}
              key={index}
              style={{ height: `${height}%` }}
            />
          );
        })}
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(boundedProgress * 1000)}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onSeek(Number(event.target.value) / 1000)}
      />
    </div>
  );
}

export function VoiceDraftPreview({
  blob,
  presentation,
  busy,
  sendDisabled = false,
  uploadProgress = null,
  onDelete,
  onSend,
}: {
  blob: Blob;
  presentation: VoiceAttachmentPresentation;
  busy: boolean;
  sendDisabled?: boolean;
  uploadProgress?: number | null;
  onDelete: () => void;
  onSend: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setSource(url);
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
      }
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  const durationSeconds = presentation.durationMs / 1_000;
  const progress = durationSeconds > 0 ? currentTime / durationSeconds : 0;
  const remaining = Math.max(0, Math.ceil(durationSeconds - currentTime));

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !source) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setPlaying(false);
      }
    } else {
      audio.pause();
    }
  }

  function seek(nextProgress: number) {
    const audio = audioRef.current;
    if (!audio || durationSeconds <= 0) return;
    const next = Math.max(0, Math.min(1, nextProgress)) * durationSeconds;
    try {
      audio.currentTime = next;
      setCurrentTime(next);
    } catch {
      // Media metadata may still be loading; keep the current playback position.
    }
  }

  return (
    <div className="voice-draft-preview" role="group" aria-label="Voice message preview">
      <audio
        ref={audioRef}
        className="voice-audio-engine"
        preload="metadata"
        src={source ?? undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
      <button
        type="button"
        className={`voice-preview-play ${playing ? "is-playing" : ""}`}
        aria-label={playing ? "Pause voice preview" : "Play voice preview"}
        disabled={busy || !source}
        onClick={() => void togglePlayback()}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <div className="voice-preview-track">
        <VoiceWaveform
          waveform={presentation.waveform}
          progress={progress}
          onSeek={seek}
          disabled={busy || !source}
          label="Voice preview position"
        />
        <small>{formatDuration(remaining)}</small>
      </div>
      <button
        type="button"
        className="voice-preview-delete"
        aria-label="Delete voice draft"
        disabled={busy}
        onClick={onDelete}
      >
        Delete
      </button>
      <button
        type="button"
        className={`voice-preview-send ${uploadProgress !== null ? "is-uploading" : ""}`}
        aria-label={uploadProgress === null ? "Send voice message" : `Sending voice message ${uploadProgress}%`}
        data-progress={uploadProgress === null ? undefined : `${uploadProgress}%`}
        disabled={busy || sendDisabled}
        onClick={onSend}
      >
        Send
      </button>
    </div>
  );
}


export function VoiceMessagePlayback({
  source,
  presentation,
  loading,
  onLoad,
}: {
  source: string | null;
  presentation?: VoiceAttachmentPresentation;
  loading: boolean;
  onLoad: () => Promise<void>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playWhenReadyRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);

  useEffect(() => {
    if (!source || !playWhenReadyRef.current) return;
    playWhenReadyRef.current = false;
    const audio = audioRef.current;
    if (audio) void audio.play().catch(() => undefined);
  }, [source]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  const durationSeconds =
    presentation?.durationMs
      ? presentation.durationMs / 1_000
      : mediaDuration ?? 0;
  const progress = durationSeconds > 0 ? currentTime / durationSeconds : 0;
  const remaining = Math.max(0, Math.ceil(durationSeconds - currentTime));

  async function togglePlayback() {
    const audio = audioRef.current;
    if (audio && source && !audio.paused) {
      audio.pause();
      return;
    }
    if (!source) {
      playWhenReadyRef.current = true;
      try {
        await onLoad();
      } catch {
        playWhenReadyRef.current = false;
      }
      return;
    }
    if (audio) {
      try {
        await audio.play();
      } catch {
        setPlaying(false);
      }
    }
  }

  function seek(nextProgress: number) {
    const audio = audioRef.current;
    if (!audio || !source || durationSeconds <= 0) return;
    const next = Math.max(0, Math.min(1, nextProgress)) * durationSeconds;
    try {
      audio.currentTime = next;
      setCurrentTime(next);
    } catch {
      // Media metadata may still be loading; keep the current playback position.
    }
  }

  return (
    <div className="voice-message-player">
      <audio
        ref={audioRef}
        className="voice-audio-engine"
        preload="metadata"
        src={source ?? undefined}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setMediaDuration(value);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
      <button
        type="button"
        className={`voice-message-play ${playing ? "is-playing" : ""}`}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        disabled={loading}
        onClick={() => void togglePlayback()}
      >
        {loading ? "…" : playing ? "Pause" : "Play"}
      </button>
      <div className="voice-message-track">
        <VoiceWaveform
          waveform={presentation?.waveform ?? []}
          progress={progress}
          onSeek={seek}
          disabled={!source || durationSeconds <= 0}
          label="Voice message position"
        />
        <small>{durationSeconds > 0 ? formatDuration(remaining) : "Voice"}</small>
      </div>
    </div>
  );
}

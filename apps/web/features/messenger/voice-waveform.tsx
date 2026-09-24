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
  onDelete,
  onSend,
}: {
  blob: Blob;
  presentation: VoiceAttachmentPresentation;
  busy: boolean;
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
    audio.currentTime = next;
    setCurrentTime(next);
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
        className="voice-preview-play"
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
        className="voice-preview-send"
        aria-label="Send voice message"
        disabled={busy}
        onClick={onSend}
      >
        Send
      </button>
    </div>
  );
}

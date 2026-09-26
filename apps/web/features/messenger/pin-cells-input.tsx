"use client";

import { useEffect, useRef, useState } from "react";

export function PinCellsInput({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
  label,
  hasError = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  label: string;
  hasError?: boolean;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const revealTimer = useRef<number | null>(null);
  const [revealed, setRevealed] = useState<{ index: number; digit: string } | null>(null);

  useEffect(() => {
    if (!autoFocus || disabled) return;
    const id = window.requestAnimationFrame(() => ref.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [autoFocus, disabled]);

  useEffect(() => () => {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
  }, []);

  return (
    <label className={`pin-cells-field${hasError ? " is-error" : ""}`}>
      <span className="sr-only">{label}</span>
      <span className="pin-cells" role="group" aria-label={label}>
        {Array.from({ length: 4 }, (_, index) => {
          const filled = index < value.length;
          const visible = revealed?.index === index && index === value.length - 1;
          return (
            <span
              className={`pin-cell${filled ? " is-filled" : ""}${index === value.length && !disabled ? " is-active" : ""}`}
              key={index}
              role="img"
              aria-label={`PIN digit ${index + 1}: ${filled ? "filled" : "empty"}`}
            >
              {filled ? (visible ? revealed!.digit : "•") : ""}
            </span>
          );
        })}
      </span>
      <input
        ref={ref}
        className="pin-cells-native"
        aria-label={label}
        name={label.toLowerCase().replace(/\s+/g, "-")}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]{4}"
        minLength={4}
        maxLength={4}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "").slice(0, 4);
          if (next.length > value.length) {
            setRevealed({ index: next.length - 1, digit: next.at(-1) ?? "" });
            if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
            revealTimer.current = window.setTimeout(() => setRevealed(null), 280);
          } else {
            setRevealed(null);
          }
          onChange(next);
        }}
      />
    </label>
  );
}

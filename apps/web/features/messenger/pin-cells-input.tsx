"use client";

import { useEffect, useRef } from "react";

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

  useEffect(() => {
    if (!autoFocus || disabled) return;
    const id = window.requestAnimationFrame(() => ref.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [autoFocus, disabled]);

  return (
    <label className={`pin-cells-field${hasError ? " is-error" : ""}`}>
      <span className="sr-only">{label}</span>
      <span className="pin-cells" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <span
            className={`pin-cell${index < value.length ? " is-filled" : ""}${index === value.length && !disabled ? " is-active" : ""}`}
            key={index}
          >
            {index < value.length ? "•" : ""}
          </span>
        ))}
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
          onChange(event.target.value.replace(/\D/g, "").slice(0, 4));
        }}
      />
    </label>
  );
}

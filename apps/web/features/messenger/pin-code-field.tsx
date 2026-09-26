"use client";

import { forwardRef } from "react";

export const PinCodeField = forwardRef<HTMLInputElement, {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
}>(
  function PinCodeField(
    { label, value, onChange, disabled = false, autoFocus = false, invalid = false },
    ref,
  ) {
    return (
      <label className="pin-code-field">
        <span className="pin-code-label">{label}</span>
        <span className={`pin-code-cells${invalid ? " is-invalid" : ""}`} aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <span className={`pin-code-cell${index < value.length ? " is-filled" : ""}`} key={index}>
              {index < value.length ? "•" : ""}
            </span>
          ))}
        </span>
        <input
          ref={ref}
          className="pin-code-input"
          name={label === "Device PIN" ? "pin" : undefined}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 4))}
          pattern="[0-9]{4}"
          minLength={4}
          maxLength={4}
          disabled={disabled}
          autoFocus={autoFocus}
        />
      </label>
    );
  },
);

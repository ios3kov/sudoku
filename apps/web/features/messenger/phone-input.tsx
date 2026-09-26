"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PHONE_COUNTRIES,
  countryFromLocale,
  formatPhone,
  toE164,
} from "./phone-number";

function inferCountry(value: string, fallback: string): string {
  const digits = value.trim().startsWith("+") ? value.replace(/\D/g, "") : "";
  if (!digits) return fallback;
  return PHONE_COUNTRIES
    .slice()
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((country) => digits.startsWith(country.dial))?.code ?? fallback;
}

function digitOrdinalBeforeCursor(value: string, cursor: number | null): number {
  if (cursor === null) return value.replace(/\D/g, "").length;
  return value.slice(0, cursor).replace(/\D/g, "").length;
}

function cursorForDigitOrdinal(value: string, ordinal: number): number {
  if (ordinal <= 0) return value.startsWith("+") ? 1 : 0;
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) {
      seen += 1;
      if (seen >= ordinal) return index + 1;
    }
  }
  return value.length;
}

export function PhoneInput({
  label,
  value = "",
  onValueChange,
  disabled = false,
  required = false,
  autoComplete = "tel",
  autoFocus = false,
}: {
  label: string;
  value?: string;
  onValueChange: (canonical: string | null, display: string) => void;
  disabled?: boolean;
  required?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  const fallbackCountry = useMemo(
    () => countryFromLocale(typeof navigator !== "undefined" ? navigator.language : undefined),
    [],
  );
  const [countryCode, setCountryCode] = useState(() => inferCountry(value, fallbackCountry));
  const [display, setDisplay] = useState(() => value ? formatPhone(value, inferCountry(value, fallbackCountry)) : "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastExternalValue = useRef(value);

  useEffect(() => {
    if (value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    const nextCountry = inferCountry(value, countryCode);
    setCountryCode(nextCountry);
    setDisplay(value ? formatPhone(value, nextCountry) : "");
  }, [countryCode, value]);

  function applyValue(raw: string, cursor: number | null) {
    const nextCountry = inferCountry(raw, countryCode);
    if (nextCountry !== countryCode) setCountryCode(nextCountry);

    const ordinal = digitOrdinalBeforeCursor(raw, cursor);
    const cursorWasAtEnd = cursor === null || cursor === raw.length;
    const formatted = formatPhone(raw, nextCountry);
    const canonical = toE164(raw, nextCountry);
    setDisplay(formatted);
    lastExternalValue.current = formatted;
    onValueChange(canonical, formatted);

    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || document.activeElement !== input) return;
      const nextCursor = cursorWasAtEnd
        ? formatted.length
        : cursorForDigitOrdinal(formatted, ordinal);
      input.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function changeCountry(nextCountry: string) {
    setCountryCode(nextCountry);
    const canonical = toE164(display, nextCountry);
    const formatted = display ? formatPhone(display, nextCountry) : "";
    setDisplay(formatted);
    lastExternalValue.current = formatted;
    onValueChange(canonical, formatted);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  const canonical = toE164(display, countryCode);

  return (
    <label className="smart-phone-field">
      <span>{label}</span>
      <span className="smart-phone-control">
        <select
          aria-label="Phone country"
          value={countryCode}
          disabled={disabled}
          onChange={(event) => changeCountry(event.target.value)}
        >
          {PHONE_COUNTRIES.map((country) => (
            <option key={country.code} value={country.code}>
              {country.code} +{country.dial}
            </option>
          ))}
        </select>
        <input
          ref={inputRef}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          value={display}
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          aria-invalid={Boolean(display) && !canonical}
          placeholder="Phone number"
          onChange={(event) => applyValue(event.target.value, event.target.selectionStart)}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!text) return;
            event.preventDefault();
            applyValue(text, text.length);
          }}
        />
      </span>
      {display && !canonical ? (
        <small className="phone-input-error">Enter a valid phone number.</small>
      ) : null}
    </label>
  );
}

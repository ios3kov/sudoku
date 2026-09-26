"use client";

import { useRef, useState } from "react";

export type CountryCode = "ME" | "RU" | "BA" | "RS" | "HR" | "US";

const COUNTRIES: Array<{ code: CountryCode; name: string; dial: string }> = [
  { code: "ME", name: "Montenegro", dial: "+382" },
  { code: "RU", name: "Russia", dial: "+7" },
  { code: "BA", name: "Bosnia & Herzegovina", dial: "+387" },
  { code: "RS", name: "Serbia", dial: "+381" },
  { code: "HR", name: "Croatia", dial: "+385" },
  { code: "US", name: "United States", dial: "+1" },
];

export function initialPhoneCountry(locale: string): CountryCode {
  const normalized = locale.replace("_", "-").toUpperCase();
  if (normalized.includes("-RU") || normalized.startsWith("RU")) return "RU";
  if (normalized.includes("-BA") || normalized.startsWith("BS")) return "BA";
  if (normalized.includes("-RS") || normalized.startsWith("SR")) return "RS";
  if (normalized.includes("-HR") || normalized.startsWith("HR")) return "HR";
  if (normalized.includes("-US") || normalized.startsWith("EN-US")) return "US";
  return "ME";
}

function countryByCode(code: CountryCode) {
  return COUNTRIES.find((item) => item.code === code) ?? COUNTRIES[0];
}

function countryFromCanonical(value: string): CountryCode | null {
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  return sorted.find((item) => value.startsWith(item.dial))?.code ?? null;
}

export function canonicalizePhone(raw: string, country: CountryCode): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    return digits ? `+${digits.slice(0, 15)}` : "";
  }

  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  const selected = countryByCode(country);
  const dialDigits = selected.dial.slice(1);

  if (country === "RU") {
    if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
    if (digits.startsWith("7")) return `+${digits.slice(0, 15)}`;
    return `+7${digits.slice(0, 14)}`;
  }

  if (digits.startsWith(dialDigits)) return `+${digits.slice(0, 15)}`;
  if (digits.startsWith("0")) digits = digits.slice(1);
  return `${selected.dial}${digits}`.slice(0, 16);
}

export function formatCanonicalPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  if (value.startsWith("+7") && digits.length > 1) {
    const local = digits.slice(1);
    if (!local) return "+7";
    const area = local.slice(0, 3);
    const first = local.slice(3, 6);
    const second = local.slice(6, 8);
    const third = local.slice(8, 10);
    let output = "+7";
    if (area) output += ` (${area}${area.length === 3 ? ")" : ""}`;
    if (first) output += ` ${first}`;
    if (second) output += `-${second}`;
    if (third) output += `-${third}`;
    return output;
  }

  const country = countryFromCanonical(value);
  if (!country) return value;
  const item = countryByCode(country);
  const local = digits.slice(item.dial.length - 1);
  const groups: string[] = [];
  for (let index = 0; index < local.length; index += 3) {
    groups.push(local.slice(index, index + 3));
  }
  return `${item.dial}${groups.length ? " " : ""}${groups.join(" ")}`.trim();
}

function rebasePhoneCountry(
  value: string,
  from: CountryCode,
  to: CountryCode,
): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  const fromDial = countryByCode(from).dial.slice(1);
  const local = digits.startsWith(fromDial) ? digits.slice(fromDial.length) : digits;
  return canonicalizePhone(local, to);
}

function caretForDigitCount(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return formatted.startsWith("+") ? 1 : 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index])) seen += 1;
    if (seen >= digitCount) return index + 1;
  }
  return formatted.length;
}

export function PhoneInput({
  value,
  onChange,
  label = "Phone number",
  name,
  disabled = false,
  required = false,
  autoComplete = "tel",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  autoComplete?: string;
}) {
  const [country, setCountry] = useState<CountryCode>(() =>
    countryFromCanonical(value)
      ?? (typeof navigator !== "undefined" ? initialPhoneCountry(navigator.language) : "ME")
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  const displayed = formatCanonicalPhone(value);

  return (
    <label className="phone-input-field">
      <span>{label}</span>
      <span className="phone-input-control">
        <select
          aria-label="Country"
          value={country}
          disabled={disabled}
          onChange={(event) => {
            const nextCountry = event.target.value as CountryCode;
            const canonical = rebasePhoneCountry(value, country, nextCountry);
            setCountry(nextCountry);
            onChange(canonical);
            window.requestAnimationFrame(() => {
              const input = inputRef.current;
              if (!input) return;
              const end = formatCanonicalPhone(canonical).length;
              input.setSelectionRange(end, end);
            });
          }}
        >
          {COUNTRIES.map((item) => (
            <option key={item.code} value={item.code}>{item.code} {item.dial}</option>
          ))}
        </select>
        <input
          ref={inputRef}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          aria-label={label}
          value={displayed}
          disabled={disabled}
          required={required}
          placeholder={countryByCode(country).dial}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            const caret = event.currentTarget.selectionStart ?? raw.length;
            const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, "").length;
            const canonical = canonicalizePhone(raw, country);
            const detectedCountry = countryFromCanonical(canonical);
            if (detectedCountry && detectedCountry !== country) setCountry(detectedCountry);
            onChange(canonical);
            window.requestAnimationFrame(() => {
              const input = inputRef.current;
              if (!input) return;
              const next = formatCanonicalPhone(canonical);
              const position = caretForDigitCount(next, digitsBeforeCaret);
              input.setSelectionRange(position, position);
            });
          }}
        />
        {name ? <input type="hidden" name={name} value={value} /> : null}
      </span>
    </label>
  );
}

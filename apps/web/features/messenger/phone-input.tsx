"use client";

import { useEffect, useState } from "react";

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
    const groups = [
      local.slice(0, 3),
      local.slice(3, 6),
      local.slice(6, 8),
      local.slice(8, 10),
    ].filter(Boolean);
    return `+7 ${groups.join(" ")}`.trim();
  }

  const country = countryFromCanonical(value);
  if (!country) return value;
  const item = countryByCode(country);
  const local = digits.slice(item.dial.length - 1);
  const groups: string[] = [];
  for (let index = 0; index < local.length; index += 3) groups.push(local.slice(index, index + 3));
  return `${item.dial}${groups.length ? " " : ""}${groups.join(" ")}`.trim();
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
  const [country, setCountry] = useState<CountryCode>(() => countryFromCanonical(value) ?? "ME");
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const fromValue = countryFromCanonical(value);
    if (fromValue) setCountry(fromValue);
    else if (!value && typeof navigator !== "undefined") setCountry(initialPhoneCountry(navigator.language));
    if (!focused) setDraft(value);
  }, [focused, value]);

  const displayed = focused ? draft : formatCanonicalPhone(value);

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
            setCountry(nextCountry);
            const canonical = canonicalizePhone(draft || value, nextCountry);
            onChange(canonical);
            setDraft(canonical);
          }}
        >
          {COUNTRIES.map((item) => (
            <option key={item.code} value={item.code}>{item.code} {item.dial}</option>
          ))}
        </select>
        <input
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          aria-label={label}
          value={displayed}
          disabled={disabled}
          required={required}
          placeholder={countryByCode(country).dial}
          onFocus={() => {
            setDraft(value);
            setFocused(true);
          }}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            onChange(canonicalizePhone(raw, country));
          }}
        />
        {name ? <input type="hidden" name={name} value={value} /> : null}
      </span>
    </label>
  );
}

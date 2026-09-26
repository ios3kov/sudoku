export type PhoneCountry = {
  code: string;
  dial: string;
  name: string;
  nationalDigits: number;
};

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "ME", dial: "382", name: "Montenegro", nationalDigits: 8 },
  { code: "RU", dial: "7", name: "Russia", nationalDigits: 10 },
  { code: "US", dial: "1", name: "United States", nationalDigits: 10 },
  { code: "GB", dial: "44", name: "United Kingdom", nationalDigits: 10 },
  { code: "DE", dial: "49", name: "Germany", nationalDigits: 10 },
  { code: "FR", dial: "33", name: "France", nationalDigits: 9 },
];

export function countryFromLocale(locale?: string): string {
  const region = locale?.split("-")[1]?.toUpperCase();
  return PHONE_COUNTRIES.some((country) => country.code === region) ? region! : "ME";
}

function countryByCode(code: string): PhoneCountry {
  return PHONE_COUNTRIES.find((country) => country.code === code) ?? PHONE_COUNTRIES[0];
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function toE164(value: string, countryCode: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("+")) {
    const digits = digitsOnly(trimmed);
    return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
  }

  const country = countryByCode(countryCode);
  let digits = digitsOnly(trimmed);

  if (country.code === "RU") {
    if (digits.length === 11 && digits.startsWith("8")) digits = digits.slice(1);
    else if (digits.length === 11 && digits.startsWith("7")) digits = digits.slice(1);
    if (digits.length !== 10) return null;
    return `+7${digits}`;
  }

  if (digits.startsWith(country.dial) && digits.length === country.dial.length + country.nationalDigits) {
    return `+${digits}`;
  }

  if (digits.startsWith("0") && country.code !== "US") digits = digits.slice(1);
  if (digits.length !== country.nationalDigits) return null;
  return `+${country.dial}${digits}`;
}

function groupGeneric(national: string): string {
  return national.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

export function formatPhone(value: string, countryCode: string): string {
  const explicitInternational = value.trim().startsWith("+");
  const e164 = toE164(value, countryCode);

  if (!e164) {
    const country = countryByCode(countryCode);
    const digits = digitsOnly(value);
    return explicitInternational ? `+${digits}` : digits;
  }

  const digits = e164.slice(1);
  const matched = PHONE_COUNTRIES
    .slice()
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((country) => digits.startsWith(country.dial));
  const country = matched ?? countryByCode(countryCode);
  const national = digits.slice(country.dial.length);

  if (country.code === "RU" && national.length <= 10) {
    const a = national.slice(0, 3);
    const b = national.slice(3, 6);
    const c = national.slice(6, 8);
    const d = national.slice(8, 10);
    return `+7${a ? ` (${a}` : ""}${a.length === 3 ? ")" : ""}${b ? ` ${b}` : ""}${c ? `-${c}` : ""}${d ? `-${d}` : ""}`;
  }

  if (country.code === "US" && national.length <= 10) {
    const a = national.slice(0, 3);
    const b = national.slice(3, 6);
    const c = national.slice(6, 10);
    return `+1${a ? ` (${a}` : ""}${a.length === 3 ? ")" : ""}${b ? ` ${b}` : ""}${c ? `-${c}` : ""}`;
  }

  return `+${country.dial}${national ? ` ${groupGeneric(national)}` : ""}`;
}

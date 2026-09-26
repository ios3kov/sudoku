import type { NativePickerContact } from "./native-contact-access";
import { PHONE_COUNTRIES, formatPhone, toE164 } from "./phone-number";

export type LocalContactSuggestion = {
  name: string;
  phone: string;
  formattedPhone: string;
};

function nationalDigits(e164: string): string {
  const digits = e164.replace(/D/g, "");
  const country = PHONE_COUNTRIES
    .slice()
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((item) => digits.startsWith(item.dial));
  return country ? digits.slice(country.dial.length) : digits;
}

function queryDigitVariants(query: string, countryCode: string): string[] {
  const digits = query.replace(/D/g, "");
  if (!digits) return [];

  const variants = new Set([digits]);
  const country = PHONE_COUNTRIES.find((item) => item.code === countryCode);

  if (country && digits.startsWith(country.dial) && digits.length > country.dial.length) {
    variants.add(digits.slice(country.dial.length));
  }

  if (countryCode === "RU" && digits.length > 1 && (digits.startsWith("8") || digits.startsWith("7"))) {
    variants.add(digits.slice(1));
  }

  return [...variants].filter(Boolean);
}

export function normalizeNativeContacts(
  contacts: NativePickerContact[],
  countryCode: string,
): LocalContactSuggestion[] {
  const output: LocalContactSuggestion[] = [];
  const seen = new Set<string>();

  for (const contact of contacts) {
    const name = contact.name?.find((value) => value.trim())?.trim() ?? "";
    for (const rawPhone of contact.tel ?? []) {
      const phone = toE164(rawPhone, countryCode);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      output.push({
        name: name || formatPhone(phone, countryCode),
        phone,
        formattedPhone: formatPhone(phone, countryCode),
      });
    }
  }

  return output;
}

export function searchLocalContacts(
  contacts: LocalContactSuggestion[],
  query: string,
  countryCode: string,
  limit = 8,
): LocalContactSuggestion[] {
  const trimmed = query.trim();
  if (!trimmed) return contacts.slice(0, limit);

  const nameQuery = trimmed.toLocaleLowerCase();
  const digitQueries = queryDigitVariants(trimmed, countryCode);

  return contacts
    .filter((contact) => {
      if (contact.name.toLocaleLowerCase().includes(nameQuery)) return true;
      if (digitQueries.length === 0) return false;

      const canonicalDigits = contact.phone.replace(/D/g, "");
      const localDigits = nationalDigits(contact.phone);
      return digitQueries.some((digits) =>
        canonicalDigits.includes(digits) || localDigits.includes(digits)
      );
    })
    .slice(0, limit);
}

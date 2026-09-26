"use client";

import {
  nativeContactsAuthorization,
  readAllNativeContacts,
  type NativePickerContact,
} from "./native-contact-access";
import { canonicalizePhone, initialPhoneCountry } from "./phone-input";

export type LocalAddressBookContact = {
  name: string;
  phones: string[];
};

export function normalizeNativeAddressBook(
  contacts: NativePickerContact[],
  locale: string,
): LocalAddressBookContact[] {
  const country = initialPhoneCountry(locale);
  const output: LocalAddressBookContact[] = [];
  const seen = new Set<string>();

  for (const contact of contacts) {
    const phones = [...new Set(
      (contact.tel ?? [])
        .map((value) => canonicalizePhone(value, country))
        .filter(Boolean),
    )];
    if (phones.length === 0) continue;
    const name = (contact.name?.[0] ?? "").trim();
    const key = `${name.toLocaleLowerCase()}|${phones.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ name, phones });
  }

  return output.sort((a, b) =>
    (a.name || a.phones[0]).localeCompare(b.name || b.phones[0]),
  );
}

export async function loadAuthorizedAddressBook(): Promise<{
  status: Awaited<ReturnType<typeof nativeContactsAuthorization>>;
  contacts: LocalAddressBookContact[];
}> {
  const status = await nativeContactsAuthorization();
  if (status !== "authorized" && status !== "limited") {
    return { status, contacts: [] };
  }

  const contacts = await readAllNativeContacts();
  const locale = typeof navigator === "undefined" ? "en-ME" : navigator.language;
  return {
    status,
    contacts: normalizeNativeAddressBook(contacts, locale),
  };
}

export function localNameForPhone(
  contacts: LocalAddressBookContact[],
  phone: string,
): string | null {
  return contacts.find((item) => item.phones.includes(phone))?.name || null;
}

export function searchLocalAddressBook(
  contacts: LocalAddressBookContact[],
  query: string,
): LocalAddressBookContact[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return contacts;
  const compact = term.replace(/\D/g, "");
  return contacts.filter((contact) => {
    if (contact.name.toLocaleLowerCase().includes(term)) return true;
    if (!compact) return false;
    return contact.phones.some((phone) => phone.replace(/\D/g, "").includes(compact));
  });
}

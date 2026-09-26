import { expect, test } from "@playwright/test";
import { normalizeNativeContacts, searchLocalContacts } from "../../features/messenger/local-contact-search";

const nativeContacts = [
  { name: ["Иван Петров"], tel: ["+7 (926) 237-36-09"] },
  { name: ["Ivan Smith"], tel: ["+382 67 123 456"] },
];

test("local invite search matches names without uploading the address book", () => {
  const contacts = normalizeNativeContacts(nativeContacts, "RU");
  expect(searchLocalContacts(contacts, "Иван", "RU")[0]?.phone).toBe("+79262373609");
  expect(searchLocalContacts(contacts, "Ivan", "RU")[0]?.phone).toBe("+38267123456");
});

test("RU phone variants and partial prefixes match the same local contact", () => {
  const contacts = normalizeNativeContacts(nativeContacts, "RU");
  for (const query of ["926", "8926", "7926", "+7926", "89262373609", "+79262373609"]) {
    expect(searchLocalContacts(contacts, query, "RU")[0]?.phone).toBe("+79262373609");
  }
});

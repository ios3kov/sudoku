import { expect, test } from "@playwright/test";
import { countryFromLocale, formatPhone, toE164 } from "../../features/messenger/phone-number";

test("Russian local and international variants normalize to one E.164 value", () => {
  const expected = "+79262373609";
  for (const value of ["9262373609", "89262373609", "79262373609", "+79262373609"]) {
    expect(toE164(value, "RU")).toBe(expected);
  }
  expect(formatPhone(expected, "RU")).toBe("+7 (926) 237-36-09");
});

test("non-RU local number uses selected country and locale inference stays explicit", () => {
  expect(toE164("67 123 456", "ME")).toBe("+38267123456");
  expect(toE164("+382 (67) 123-456", "US")).toBe("+38267123456");
  expect(countryFromLocale("sr-ME")).toBe("ME");
  expect(countryFromLocale("ru-RU")).toBe("RU");
  expect(countryFromLocale("en-US")).toBe("US");
});

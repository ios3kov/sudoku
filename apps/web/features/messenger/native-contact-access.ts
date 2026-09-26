"use client";

export const NATIVE_CONTACTS_READY_EVENT = "sudoku:native-contacts-ready";

export type NativePickerContact = {
  name?: string[];
  tel?: string[];
};

export type NativeContactsAuthorization =
  | "not_determined"
  | "granted"
  | "limited"
  | "denied"
  | "restricted";

type NativeContactsBridge = {
  select: () => Promise<NativePickerContact[]>;
  status?: () => Promise<NativeContactsAuthorization>;
  requestAll?: () => Promise<NativePickerContact[]>;
};

declare global {
  interface Window {
    SudokuNativeContacts?: NativeContactsBridge;
  }
}

export function nativeContactsAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.SudokuNativeContacts?.select === "function";
}

export function nativeFullContactsAvailable(): boolean {
  return nativeContactsAvailable()
    && typeof window.SudokuNativeContacts?.status === "function"
    && typeof window.SudokuNativeContacts?.requestAll === "function";
}

export async function selectNativeContacts(): Promise<NativePickerContact[]> {
  if (!nativeContactsAvailable()) {
    throw new Error("Native contacts bridge is unavailable");
  }
  return window.SudokuNativeContacts!.select();
}

export async function nativeContactsAuthorization(): Promise<NativeContactsAuthorization> {
  if (!nativeFullContactsAvailable()) {
    throw new Error("Full Contacts bridge is unavailable");
  }
  return window.SudokuNativeContacts!.status!();
}

export async function requestAllNativeContacts(): Promise<NativePickerContact[]> {
  if (!nativeFullContactsAvailable()) {
    throw new Error("Full Contacts bridge is unavailable");
  }
  return window.SudokuNativeContacts!.requestAll!();
}

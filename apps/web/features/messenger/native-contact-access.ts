"use client";

export const NATIVE_CONTACTS_READY_EVENT = "sudoku:native-contacts-ready";

export type NativePickerContact = {
  name?: string[];
  tel?: string[];
};

export type NativeContactsAuthorization =
  | "not_determined"
  | "restricted"
  | "denied"
  | "authorized"
  | "limited"
  | "unknown";

type NativeContactsBridge = {
  select: () => Promise<NativePickerContact[]>;
  all?: () => Promise<NativePickerContact[]>;
  status?: () => Promise<NativeContactsAuthorization>;
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
  return typeof window !== "undefined"
    && typeof window.SudokuNativeContacts?.all === "function"
    && typeof window.SudokuNativeContacts?.status === "function";
}

export async function selectNativeContacts(): Promise<NativePickerContact[]> {
  if (!nativeContactsAvailable()) {
    throw new Error("Native contacts bridge is unavailable");
  }
  return window.SudokuNativeContacts!.select();
}

export async function readAllNativeContacts(): Promise<NativePickerContact[]> {
  if (!nativeFullContactsAvailable()) {
    throw new Error("Full contacts access is unavailable");
  }
  return window.SudokuNativeContacts!.all!();
}

export async function nativeContactsAuthorization(): Promise<NativeContactsAuthorization> {
  if (!nativeFullContactsAvailable()) return "unknown";
  return window.SudokuNativeContacts!.status!();
}

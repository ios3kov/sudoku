"use client";

export const NATIVE_CONTACTS_READY_EVENT = "sudoku:native-contacts-ready";

export type NativePickerContact = {
  name?: string[];
  tel?: string[];
};

type NativeContactsBridge = {
  select: () => Promise<NativePickerContact[]>;
};

declare global {
  interface Window {
    SudokuNativeContacts?: NativeContactsBridge;
  }
}

export function nativeContactsAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.SudokuNativeContacts?.select === "function";
}

export async function selectNativeContacts(): Promise<NativePickerContact[]> {
  if (!nativeContactsAvailable()) {
    throw new Error("Native contacts bridge is unavailable");
  }
  return window.SudokuNativeContacts!.select();
}

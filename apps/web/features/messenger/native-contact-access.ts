"use client";

export const NATIVE_CONTACTS_READY_EVENT = "sudoku:native-contacts-ready";

export type NativePickerContact = {
  name?: string[];
  tel?: string[];
};

type NativeContactsBridge = {
  select: () => Promise<NativePickerContact[]>;
};

type CapacitorNativeContactsPlugin = {
  selectContacts: () => Promise<{ contacts?: NativePickerContact[] }>;
};

declare global {
  interface Window {
    SudokuNativeContacts?: NativeContactsBridge;
    Capacitor?: {
      Plugins?: {
        SudokuNative?: CapacitorNativeContactsPlugin;
      };
    };
  }
}

function capacitorContacts(): CapacitorNativeContactsPlugin | null {
  return window.Capacitor?.Plugins?.SudokuNative ?? null;
}

export function nativeContactsAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof window.SudokuNativeContacts?.select === "function" ||
    typeof capacitorContacts()?.selectContacts === "function"
  );
}

export async function selectNativeContacts(): Promise<NativePickerContact[]> {
  if (typeof window === "undefined") {
    throw new Error("Native contacts bridge is unavailable");
  }

  if (typeof window.SudokuNativeContacts?.select === "function") {
    return window.SudokuNativeContacts.select();
  }

  const plugin = capacitorContacts();
  if (typeof plugin?.selectContacts === "function") {
    const result = await plugin.selectContacts();
    return result.contacts ?? [];
  }

  throw new Error("Native contacts bridge is unavailable");
}

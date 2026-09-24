"use client";

export const NATIVE_BIOMETRIC_READY_EVENT = "sudoku:native-biometric-ready";

export type NativeBiometricStatus = {
  available: boolean;
  enrolled: boolean;
  type: "faceID" | "touchID" | "none" | "unknown";
};

type NativeBiometricBridge = {
  status: () => Promise<NativeBiometricStatus>;
  enroll: (pin: string) => Promise<NativeBiometricStatus>;
  clear: () => Promise<NativeBiometricStatus>;
  unlock: () => Promise<{ pin: string }>;
};

declare global {
  interface Window {
    SudokuNativeBiometric?: NativeBiometricBridge;
  }
}

export function nativeBiometricBridgeAvailable(): boolean {
  return typeof window !== "undefined"
    && typeof window.SudokuNativeBiometric?.status === "function"
    && typeof window.SudokuNativeBiometric?.unlock === "function";
}

export async function nativeBiometricStatus(): Promise<NativeBiometricStatus> {
  if (!nativeBiometricBridgeAvailable()) {
    return { available: false, enrolled: false, type: "none" };
  }
  const status = await window.SudokuNativeBiometric!.status();
  return {
    available: status.available === true,
    enrolled: status.enrolled === true,
    type: ["faceID", "touchID", "none", "unknown"].includes(status.type)
      ? status.type
      : "unknown",
  } as NativeBiometricStatus;
}

export async function enrollNativeBiometricPin(pin: string): Promise<NativeBiometricStatus> {
  if (!/^[0-9]{4}$/.test(pin) || !nativeBiometricBridgeAvailable()) {
    throw new Error("Native biometric quick unlock is unavailable");
  }
  return window.SudokuNativeBiometric!.enroll(pin);
}

export async function clearNativeBiometricPin(): Promise<void> {
  if (!nativeBiometricBridgeAvailable()) return;
  await window.SudokuNativeBiometric!.clear();
}

export async function unlockWithNativeBiometric(): Promise<string> {
  if (!nativeBiometricBridgeAvailable()) {
    throw new Error("Native biometric quick unlock is unavailable");
  }
  const result = await window.SudokuNativeBiometric!.unlock();
  if (!result || typeof result.pin !== "string" || !/^[0-9]{4}$/.test(result.pin)) {
    throw new Error("Native biometric quick unlock returned an invalid credential");
  }
  return result.pin;
}

export function nativeBiometricLabel(type: NativeBiometricStatus["type"]): string {
  if (type === "faceID") return "Face ID";
  if (type === "touchID") return "Touch ID";
  return "Biometrics";
}

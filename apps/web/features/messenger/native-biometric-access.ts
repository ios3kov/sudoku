"use client";

export const NATIVE_BIOMETRICS_READY_EVENT = "sudoku:native-biometrics-ready";

export type NativeBiometricAvailability = {
  available: boolean;
  kind: "faceID" | "touchID" | "opticID" | "biometric" | "none";
  label: string;
};

type NativeBiometricBridge = {
  availability: () => Promise<NativeBiometricAvailability>;
  enroll: () => Promise<{ publicKeyX963B64: string }>;
  sign: (payload: string) => Promise<{ signatureB64: string }>;
  clear: () => Promise<void>;
};

declare global {
  interface Window {
    SudokuNativeBiometrics?: NativeBiometricBridge;
  }
}

function bridge(): NativeBiometricBridge {
  if (typeof window === "undefined" || !window.SudokuNativeBiometrics) {
    throw new Error("Native biometrics bridge is unavailable");
  }
  return window.SudokuNativeBiometrics;
}

export function nativeBiometricsAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.SudokuNativeBiometrics);
}

export async function nativeBiometricAvailability(): Promise<NativeBiometricAvailability> {
  return bridge().availability();
}

export async function enrollNativeBiometric(): Promise<string> {
  const result = await bridge().enroll();
  if (!result || typeof result.publicKeyX963B64 !== "string" || result.publicKeyX963B64.length < 80) {
    throw new Error("Native biometric enrollment returned an invalid public key");
  }
  return result.publicKeyX963B64;
}

export async function signNativeBiometric(payload: string): Promise<string> {
  if (!payload.startsWith("sudoku-biometric-unlock:v1:") || payload.length > 256) {
    throw new Error("Invalid biometric signing payload");
  }
  const result = await bridge().sign(payload);
  if (!result || typeof result.signatureB64 !== "string" || result.signatureB64.length < 64) {
    throw new Error("Native biometric signature is invalid");
  }
  return result.signatureB64;
}

export async function clearNativeBiometric(): Promise<void> {
  if (!nativeBiometricsAvailable()) return;
  await bridge().clear();
}

export function nativeBiometricErrorCode(reason: unknown): string | null {
  if (!reason || typeof reason !== "object" || !("code" in reason)) return null;
  const code = (reason as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isNativeBiometricCancellation(reason: unknown): boolean {
  return nativeBiometricErrorCode(reason) === "cancelled";
}

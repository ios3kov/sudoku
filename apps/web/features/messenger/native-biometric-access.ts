"use client";

export const NATIVE_BIOMETRICS_READY_EVENT = "sudoku:native-biometrics-ready";

export type NativeBiometricKind = "face" | "touch" | "biometric" | "none";

export type NativeBiometricAvailability = {
  available: boolean;
  kind: NativeBiometricKind;
};

type NativeBiometricsBridge = {
  availability: () => Promise<NativeBiometricAvailability>;
  enroll: () => Promise<{ publicKeyX963B64: string }>;
  sign: (payload: string) => Promise<{ signatureB64: string }>;
  remove: () => Promise<boolean>;
};

declare global {
  interface Window {
    SudokuNativeBiometrics?: NativeBiometricsBridge;
  }
}

export function nativeBiometricsAvailable(): boolean {
  return typeof window !== "undefined"
    && typeof window.SudokuNativeBiometrics?.availability === "function";
}

function bridge(): NativeBiometricsBridge {
  if (!nativeBiometricsAvailable()) {
    throw new DOMException(
      "Native biometric bridge is unavailable",
      "NotSupportedError",
    );
  }
  return window.SudokuNativeBiometrics!;
}

export async function getNativeBiometricAvailability(): Promise<NativeBiometricAvailability> {
  return bridge().availability();
}

export async function enrollNativeBiometricCredential(): Promise<string> {
  const result = await bridge().enroll();
  if (
    !result
    || typeof result.publicKeyX963B64 !== "string"
    || result.publicKeyX963B64.length < 80
  ) {
    throw new DOMException(
      "Invalid native biometric public key",
      "DataError",
    );
  }
  return result.publicKeyX963B64;
}

export async function signNativeBiometricPayload(payload: string): Promise<string> {
  if (!payload.startsWith("sudoku-biometric-unlock:v1:") || payload.length > 512) {
    throw new DOMException("Invalid biometric payload", "DataError");
  }
  const result = await bridge().sign(payload);
  if (
    !result
    || typeof result.signatureB64 !== "string"
    || result.signatureB64.length < 64
  ) {
    throw new DOMException(
      "Invalid native biometric signature",
      "DataError",
    );
  }
  return result.signatureB64;
}

export async function removeNativeBiometricCredential(): Promise<void> {
  if (!nativeBiometricsAvailable()) return;
  await bridge().remove();
}

export function biometricLabel(kind: NativeBiometricKind): string {
  if (kind === "face") return "Face ID";
  if (kind === "touch") return "Touch ID";
  return "Biometrics";
}

export function isNativeBiometricCancellation(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

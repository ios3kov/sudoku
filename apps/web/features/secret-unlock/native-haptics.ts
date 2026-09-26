"use client";

export type NativeHapticKind = "selection" | "impact";

type NativeHapticWindow = Window & {
  webkit?: {
    messageHandlers?: {
      sudokuHaptics?: {
        postMessage: (payload: { kind: NativeHapticKind }) => void;
      };
    };
  };
};

export function triggerNativeHaptic(kind: NativeHapticKind): void {
  try {
    (window as NativeHapticWindow).webkit?.messageHandlers?.sudokuHaptics?.postMessage({ kind });
  } catch {
    // Browser/PWA mode intentionally has no native haptic bridge.
  }
}

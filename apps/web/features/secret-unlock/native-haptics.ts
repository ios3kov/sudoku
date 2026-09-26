"use client";

export type NativeHapticKind = "selection" | "impact";

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        sudokuTheme?: {
          postMessage: (payload: { surface: "sudoku" | "messenger" }) => void;
        };
        sudokuHaptics?: {
          postMessage: (payload: { kind: NativeHapticKind }) => void;
        };
      };
    };
  }
}

export function triggerNativeHaptic(kind: NativeHapticKind): void {
  try {
    window.webkit?.messageHandlers?.sudokuHaptics?.postMessage({ kind });
  } catch {
    // Browser/PWA mode intentionally has no native haptic bridge.
  }
}

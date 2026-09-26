"use client";

export type NativeSurfaceName = "sudoku" | "messenger";

type NativeThemePayload =
  | { surface: NativeSurfaceName }
  | { action: "captureSudokuSnapshot" };

type NativeThemeWindow = Window & {
  webkit?: {
    messageHandlers?: {
      sudokuTheme?: {
        postMessage: (payload: NativeThemePayload) => void;
      };
    };
  };
};

function postNativeTheme(payload: NativeThemePayload): void {
  try {
    (window as NativeThemeWindow).webkit?.messageHandlers?.sudokuTheme?.postMessage(payload);
  } catch {
    // Browser/PWA mode has no native bridge; visual state remains web-owned.
  }
}

export function syncNativeSurfaceTheme(surface: NativeSurfaceName): void {
  postNativeTheme({ surface });
}

export function captureNativeSudokuSnapshot(): void {
  postNativeTheme({ action: "captureSudokuSnapshot" });
}

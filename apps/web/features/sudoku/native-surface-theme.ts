"use client";

export type NativeSurfaceName = "sudoku" | "messenger";

type NativeThemeWindow = Window & {
  webkit?: {
    messageHandlers?: {
      sudokuTheme?: {
        postMessage: (payload: { surface: NativeSurfaceName }) => void;
      };
    };
  };
};

export function syncNativeSurfaceTheme(surface: NativeSurfaceName): void {
  try {
    (window as NativeThemeWindow).webkit?.messageHandlers?.sudokuTheme?.postMessage({ surface });
  } catch {
    // Browser/PWA mode has no native bridge; visual state remains web-owned.
  }
}

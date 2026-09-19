"use client";

import { useEffect, useRef } from "react";
import { SudokuBoard } from "../features/sudoku/sudoku-board";
import { AuthGate } from "../features/messenger/auth-gate";
import { useAppStore } from "../store/app-store";

const BACKGROUND_HIDE_MS = 30_000;

export function HomeClient() {
  const mode = useAppStore((state) => state.mode);
  const showMessengerLock = useAppStore((state) => state.showMessengerLock);
  const hidePrivateSurface = useAppStore((state) => state.hidePrivateSurface);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    function handleServiceWorkerMessage(event: MessageEvent) {
      if (event.data?.type === "FORCE_SUDOKU") hidePrivateSurface();
    }
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
  }, [hidePrivateSurface]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }

      if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= BACKGROUND_HIDE_MS) {
        hidePrivateSurface();
      }
      hiddenAt.current = null;
    }

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [hidePrivateSurface]);

  if (mode === "messenger-lock") {
    return <AuthGate onHide={hidePrivateSurface} />;
  }

  return <SudokuBoard onSecretUnlock={showMessengerLock} />;
}

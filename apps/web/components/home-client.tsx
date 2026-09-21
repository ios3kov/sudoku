"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shouldLockPrivateSurface } from "@sudoku/domain";
import { SudokuBoard } from "../features/sudoku/sudoku-board";
import { AuthGate } from "../features/messenger/auth-gate";
import { useAppStore } from "../store/app-store";

export function HomeClient() {
  const mode = useAppStore((state) => state.mode);
  const showMessengerLock = useAppStore((state) => state.showMessengerLock);
  const hidePrivateSurface = useAppStore((state) => state.hidePrivateSurface);
  const hiddenAt = useRef<number | null>(null);
  const [privacyCover, setPrivacyCover] = useState(false);

  const hidePrivate = useCallback(() => {
    hidePrivateSurface();
  }, [hidePrivateSurface]);

  useEffect(() => {
    function forceSudoku() {
      setPrivacyCover(true);
      hidePrivateSurface();
      requestAnimationFrame(() => setPrivacyCover(false));
    }
    function handleServiceWorkerMessage(event: MessageEvent) {
      if (event.data?.type === "FORCE_SUDOKU") forceSudoku();
    }
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
  }, [hidePrivateSurface]);

  useEffect(() => {
    function concealNow() {
      // Always replace the current visual tree while the page is hidden. This
      // also guarantees that a half-finished Sudoku reveal can never be frozen
      // in the OS app switcher with private content exposed underneath.
      setPrivacyCover(true);
      hiddenAt.current = Date.now();
    }
    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        concealNow();
        return;
      }
      const shouldLock = mode !== "sudoku" && shouldLockPrivateSurface(hiddenAt.current, Date.now());
      if (shouldLock) hidePrivateSurface();
      hiddenAt.current = null;
      requestAnimationFrame(() => setPrivacyCover(false));
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", concealNow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", concealNow);
    };
  }, [hidePrivateSurface, mode]);

  if (privacyCover) {
    return <main className="shell"><section className="card"><h1>Sudoku</h1><div className="privacy-grid" aria-hidden="true" /></section></main>;
  }

  const privateActive = mode === "messenger-lock";

  return (
    <div className={`home-reveal-stage${privateActive ? " private-active" : ""}`}>
      <div
        className={`private-reveal-layer${privateActive ? " is-active" : ""}`}
        aria-hidden={privateActive ? undefined : true}
        inert={privateActive ? undefined : true}
      >
        <AuthGate onHide={hidePrivate} active={privateActive} />
      </div>

      {mode === "sudoku" ? (
        <SudokuBoard onSecretUnlock={showMessengerLock} />
      ) : null}
    </div>
  );
}

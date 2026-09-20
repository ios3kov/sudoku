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
  const [privateUnderlayMounted, setPrivateUnderlayMounted] = useState(false);

  const hidePrivate = useCallback(() => {
    setPrivateUnderlayMounted(false);
    hidePrivateSurface();
  }, [hidePrivateSurface]);

  const beginPrivateReveal = useCallback(() => {
    setPrivateUnderlayMounted(true);
  }, []);

  const cancelPrivateReveal = useCallback(() => {
    setPrivateUnderlayMounted(false);
  }, []);

  const completePrivateReveal = useCallback(() => {
    setPrivateUnderlayMounted(true);
    showMessengerLock();
  }, [showMessengerLock]);

  useEffect(() => {
    function forceSudoku() {
      setPrivacyCover(true);
      setPrivateUnderlayMounted(false);
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
      if (mode !== "sudoku") setPrivacyCover(true);
      hiddenAt.current = Date.now();
    }
    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        concealNow();
        return;
      }
      const shouldLock = mode !== "sudoku" && shouldLockPrivateSurface(hiddenAt.current, Date.now());
      if (shouldLock) {
        setPrivateUnderlayMounted(false);
        hidePrivateSurface();
      }
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

  const privateVisible = mode === "messenger-lock" || privateUnderlayMounted;

  return (
    <div className={`home-reveal-stage${mode === "messenger-lock" ? " private-active" : ""}`}>
      {privateVisible ? (
        <div
          className={`private-reveal-layer${mode === "messenger-lock" ? " is-active" : ""}`}
          aria-hidden={mode === "sudoku"}
        >
          <AuthGate onHide={hidePrivate} />
        </div>
      ) : null}

      {mode === "sudoku" ? (
        <SudokuBoard
          onSecretRevealStart={beginPrivateReveal}
          onSecretRevealCancel={cancelPrivateReveal}
          onSecretUnlock={completePrivateReveal}
        />
      ) : null}
    </div>
  );
}

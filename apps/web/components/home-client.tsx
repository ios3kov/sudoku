"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shouldLockPrivateSurface } from "@sudoku/domain";
import { SudokuBoard } from "../features/sudoku/sudoku-board";
import { AuthGate } from "../features/messenger/auth-gate";
import { useAppStore } from "../store/app-store";

type NativeMessageHandler = { postMessage: (message: unknown) => void };
type NativeWindow = Window & {
  webkit?: { messageHandlers?: Record<string, NativeMessageHandler> };
};

function notifyNativePrivacyState(state: "sudoku" | "private") {
  (window as NativeWindow).webkit?.messageHandlers?.sudokuPrivacyState?.postMessage({ state });
}

export function HomeClient() {
  const mode = useAppStore((state) => state.mode);
  const showMessengerLock = useAppStore((state) => state.showMessengerLock);
  const hidePrivateSurface = useAppStore((state) => state.hidePrivateSurface);
  const hiddenAt = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [privacyCover, setPrivacyCover] = useState(false);
  const [sudokuReady, setSudokuReady] = useState(false);

  const hidePrivate = useCallback(() => {
    hidePrivateSurface();
  }, [hidePrivateSurface]);

  const markSudokuReady = useCallback(() => {
    setSudokuReady(true);
  }, []);

  useEffect(() => {
    notifyNativePrivacyState(mode === "sudoku" ? "sudoku" : "private");
  }, [mode]);

  useEffect(() => {
    function showRetainedSudoku() {
      stageRef.current?.classList.add("is-privacy-shielded");
      setPrivacyCover(true);
    }

    function clearRetainedSudoku() {
      stageRef.current?.classList.remove("is-privacy-shielded");
      setPrivacyCover(false);
    }

    function forceSudoku() {
      showRetainedSudoku();
      hidePrivateSurface();
      requestAnimationFrame(clearRetainedSudoku);
    }

    function handleServiceWorkerMessage(event: MessageEvent) {
      if (event.data?.type === "FORCE_SUDOKU") forceSudoku();
    }

    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
  }, [hidePrivateSurface]);

  useEffect(() => {
    function concealNow() {
      // Keep the real Sudoku mounted at all times and synchronously raise it
      // above the private surface before the browser/OS can capture a task
      // preview. The fallback is reserved for a cold page that has not hydrated
      // a usable Sudoku state yet.
      stageRef.current?.classList.add("is-privacy-shielded");
      setPrivacyCover(true);
      hiddenAt.current = Date.now();
    }

    function revealCurrentSurface() {
      stageRef.current?.classList.remove("is-privacy-shielded");
      setPrivacyCover(false);
    }

    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        concealNow();
        return;
      }

      const shouldLock =
        mode !== "sudoku" && shouldLockPrivateSurface(hiddenAt.current, Date.now());
      if (shouldLock) hidePrivateSurface();

      hiddenAt.current = null;
      requestAnimationFrame(revealCurrentSurface);
    }

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", concealNow);
    window.addEventListener("pageshow", revealCurrentSurface);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", concealNow);
      window.removeEventListener("pageshow", revealCurrentSurface);
    };
  }, [hidePrivateSurface, mode]);

  const privateActive = mode === "messenger-lock";
  const privateInteractive = privateActive && !privacyCover;

  return (
    <>
      <div
        ref={stageRef}
        className={
          `home-reveal-stage${privateActive ? " is-private" : ""}${
            privacyCover ? " is-privacy-shielded" : ""
          }`
        }
      >
        <div
          className={`private-reveal-layer${privateActive ? " is-active" : ""}`}
          aria-hidden={privateInteractive ? undefined : true}
          inert={privateInteractive ? undefined : true}
        >
          <AuthGate onHide={hidePrivate} active={privateActive} />
        </div>

        <SudokuBoard
          active={!privateActive}
          onReady={markSudokuReady}
          onSecretUnlock={showMessengerLock}
        />
      </div>

      {privacyCover && !sudokuReady ? (
        <main className="shell privacy-fallback">
          <section className="card">
            <h1>Sudoku</h1>
            <div className="privacy-grid" aria-hidden="true" />
          </section>
        </main>
      ) : null}
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  armFromFive,
  beginSwipe,
  createGestureState,
  finishSwipe,
  type GestureState,
} from "@sudoku/domain";

const REVEAL_START_PX = 6;
const CLICK_SUPPRESS_PX = 12;
const RETURN_MS = 260;
const FINISH_MS = 340;

interface SecretUnlockOptions {
  onUnlock: () => void;
  onRevealStart: () => void;
  onRevealCancel: () => void;
}

export function useSecretUnlock({
  onUnlock,
  onRevealStart,
  onRevealCancel,
}: SecretUnlockOptions) {
  const screenRef = useRef<HTMLElement | null>(null);
  const state = useRef<GestureState>(createGestureState());
  const pointerActive = useRef(false);
  const startY = useRef<number | null>(null);
  const currentOffset = useRef(0);
  const pendingOffset = useRef(0);
  const suppressNextFiveClick = useRef(false);
  const revealStarted = useRef(false);
  const frame = useRef<number | null>(null);
  const phaseTimer = useRef<number | null>(null);

  const clearPhaseTimer = useCallback(() => {
    if (phaseTimer.current !== null) {
      window.clearTimeout(phaseTimer.current);
      phaseTimer.current = null;
    }
  }, []);

  const flushOffset = useCallback((offset: number) => {
    currentOffset.current = offset;
    pendingOffset.current = offset;

    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      screenRef.current?.style.setProperty("--unlock-offset", `${pendingOffset.current}px`);
      frame.current = null;
    });
  }, []);

  const ensureRevealStarted = useCallback(() => {
    if (revealStarted.current) return;
    revealStarted.current = true;
    onRevealStart();
  }, [onRevealStart]);

  const finishReturn = useCallback(() => {
    const screen = screenRef.current;
    screen?.classList.remove("is-dragging", "is-unlocking");
    screen?.classList.add("is-returning");
    flushOffset(0);

    clearPhaseTimer();
    phaseTimer.current = window.setTimeout(() => {
      screenRef.current?.classList.remove("is-returning");
      if (revealStarted.current) {
        revealStarted.current = false;
        onRevealCancel();
      }
    }, RETURN_MS);
  }, [clearPhaseTimer, flushOffset, onRevealCancel]);

  useEffect(() => {
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      if (phaseTimer.current !== null) window.clearTimeout(phaseTimer.current);
    };
  }, []);

  const onFivePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    clearPhaseTimer();

    const screen = screenRef.current;
    screen?.classList.remove("is-returning", "is-unlocking");
    screen?.classList.add("is-dragging");
    screen?.style.setProperty("--unlock-offset", "0px");

    const now = performance.now();
    const armed = armFromFive(createGestureState(), now);
    state.current = beginSwipe(
      armed,
      { x: event.clientX, y: event.clientY },
      now,
    );

    pointerActive.current = true;
    startY.current = event.clientY;
    currentOffset.current = 0;
    pendingOffset.current = 0;
    suppressNextFiveClick.current = false;

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic browser-test events may not own an active pointer.
    }
  }, [clearPhaseTimer]);

  const onFivePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerActive.current || startY.current === null) return;

    const upwardDistance = Math.max(0, startY.current - event.clientY);
    const viewportLimit = Math.max(120, window.innerHeight);
    const nextOffset = Math.min(viewportLimit, upwardDistance);

    if (nextOffset >= REVEAL_START_PX) ensureRevealStarted();
    flushOffset(nextOffset);
  }, [ensureRevealStarted, flushOffset]);

  const onFivePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerActive.current) return;

    const result = finishSwipe(
      state.current,
      { x: event.clientX, y: event.clientY },
      performance.now(),
    );

    state.current = result.state;
    pointerActive.current = false;
    startY.current = null;

    const screen = screenRef.current;
    screen?.classList.remove("is-dragging");

    if (!result.unlocked) {
      suppressNextFiveClick.current = currentOffset.current > CLICK_SUPPRESS_PX;
      if (currentOffset.current > 0 || revealStarted.current) finishReturn();
      return;
    }

    ensureRevealStarted();
    suppressNextFiveClick.current = true;
    event.preventDefault();

    // Lock the current compositor position before switching to the finishing
    // transition so the screen continues from exactly where the finger left it.
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    screen?.style.setProperty("--unlock-offset", `${currentOffset.current}px`);
    if (screen) void screen.offsetHeight;
    screen?.classList.add("is-unlocking");

    clearPhaseTimer();
    phaseTimer.current = window.setTimeout(() => {
      onUnlock();
    }, FINISH_MS);
  }, [clearPhaseTimer, ensureRevealStarted, finishReturn, onUnlock]);

  const consumeFiveClick = useCallback(() => {
    if (!suppressNextFiveClick.current) return false;
    suppressNextFiveClick.current = false;
    return true;
  }, []);

  const cancel = useCallback(() => {
    state.current = createGestureState();
    pointerActive.current = false;
    startY.current = null;
    suppressNextFiveClick.current = currentOffset.current > CLICK_SUPPRESS_PX;

    if (currentOffset.current > 0 || revealStarted.current) {
      finishReturn();
    } else {
      screenRef.current?.classList.remove("is-dragging");
    }
  }, [finishReturn]);

  return {
    screenRef,
    onFivePointerDown,
    onFivePointerMove,
    onFivePointerUp,
    consumeFiveClick,
    cancel,
  };
}

"use client";

import { useCallback, useEffect, useRef } from "react";

const CLICK_SUPPRESS_PX = 12;
const UNLOCK_PROGRESS = 0.5;
const RELEASE_PROJECTION_MS = 180;
const FLICK_MIN_VELOCITY_PX_PER_MS = 0.45;
const VELOCITY_STALE_MS = 120;
const RETURN_MS = 320;
const FINISH_MIN_MS = 260;
const FINISH_MAX_MS = 420;
const PRIVATE_REVEAL_DISTANCE_PX = 220;
const OFFSCREEN_OVERSHOOT_PX = 28;

function motionDuration(defaultMs: number): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 20 : defaultMs;
}

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

type NativeMessageHandler = { postMessage: (message: unknown) => void };
type NativeWindow = Window & {
  webkit?: { messageHandlers?: Record<string, NativeMessageHandler> };
};

function notifyNativeSnapshotRequest() {
  (window as NativeWindow).webkit?.messageHandlers?.sudokuPrivacySnapshot?.postMessage({
    reason: "messenger-reveal-start",
  });
}

interface SecretUnlockOptions {
  enabled?: boolean;
  onUnlock: () => void;
}

export function useSecretUnlock({ enabled = true, onUnlock }: SecretUnlockOptions) {
  const screenRef = useRef<HTMLElement | null>(null);
  const underlayRef = useRef<HTMLElement | null>(null);
  const pointerActive = useRef(false);
  const unlocking = useRef(false);
  const startY = useRef<number | null>(null);
  const unlockThreshold = useRef(0);
  const currentOffset = useRef(0);
  const pendingOffset = useRef(0);
  const viewportHeight = useRef(0);
  const lastMoveAt = useRef(0);
  const lastMoveOffset = useRef(0);
  const upwardVelocity = useRef(0);
  const suppressNextFiveClick = useRef(false);
  const frame = useRef<number | null>(null);
  const phaseTimer = useRef<number | null>(null);

  const setScreenElement = useCallback((node: HTMLElement | null) => {
    screenRef.current = node;
    underlayRef.current = node?.parentElement?.querySelector<HTMLElement>(".private-reveal-layer") ?? null;
  }, []);

  const clearPhaseTimer = useCallback(() => {
    if (phaseTimer.current !== null) {
      window.clearTimeout(phaseTimer.current);
      phaseTimer.current = null;
    }
  }, []);

  const clearFrame = useCallback(() => {
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  const setUnderlayProgress = useCallback((progress: number) => {
    const underlay = underlayRef.current;
    if (!underlay) return;

    const p = clamp(0, 1, progress);
    const scale = 0.965 + p * 0.035;
    const translateY = (1 - p) * 22;
    underlay.style.transform = `translate3d(0, ${translateY.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
    underlay.style.opacity = String(0.84 + p * 0.16);
  }, []);

  const applyOffset = useCallback((offset: number) => {
    const safeOffset = Math.max(0, offset);
    currentOffset.current = safeOffset;

    const screen = screenRef.current;
    if (screen) {
      screen.style.transform = `translate3d(0, -${safeOffset.toFixed(2)}px, 0)`;
    }
    setUnderlayProgress(safeOffset / PRIVATE_REVEAL_DISTANCE_PX);
  }, [setUnderlayProgress]);

  const queueOffset = useCallback((offset: number) => {
    currentOffset.current = Math.max(0, offset);
    pendingOffset.current = currentOffset.current;

    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      applyOffset(pendingOffset.current);
      frame.current = null;
    });
  }, [applyOffset]);

  const resetInlineMotion = useCallback(() => {
    const screen = screenRef.current;
    const underlay = underlayRef.current;

    screen?.style.removeProperty("transition");
    screen?.style.removeProperty("transform");
    underlay?.style.removeProperty("transition");
    underlay?.style.removeProperty("transform");
    underlay?.style.removeProperty("opacity");
  }, []);

  const animateReturn = useCallback(() => {
    clearFrame();

    const duration = motionDuration(RETURN_MS);
    const screen = screenRef.current;
    const underlay = underlayRef.current;

    screen?.classList.remove("is-dragging", "is-unlocking");
    screen?.classList.add("is-returning");

    if (screen) {
      screen.style.transition = `transform ${duration}ms cubic-bezier(.25,.9,.3,1)`;
    }
    if (underlay) {
      underlay.style.transition =
        `transform ${duration}ms cubic-bezier(.25,.9,.3,1), opacity ${Math.min(duration, 220)}ms ease-out`;
    }

    applyOffset(currentOffset.current);
    if (screen) void screen.offsetHeight;

    window.requestAnimationFrame(() => {
      applyOffset(0);
    });

    clearPhaseTimer();
    phaseTimer.current = window.setTimeout(() => {
      screenRef.current?.classList.remove("is-returning");
      currentOffset.current = 0;
      pendingOffset.current = 0;
      resetInlineMotion();
    }, duration + 24);
  }, [applyOffset, clearFrame, clearPhaseTimer, resetInlineMotion]);

  const animateUnlock = useCallback(() => {
    if (!enabled || unlocking.current) return;

    clearFrame();

    const screen = screenRef.current;
    const underlay = underlayRef.current;
    const targetOffset = Math.max(360, viewportHeight.current) + OFFSCREEN_OVERSHOOT_PX;
    const remainingRatio = clamp(
      0,
      1,
      (targetOffset - currentOffset.current) / Math.max(1, targetOffset),
    );
    const velocityBonus = clamp(0, 100, upwardVelocity.current * 70);
    const naturalDuration = 250 + remainingRatio * 160 - velocityBonus;
    const duration = motionDuration(
      Math.round(clamp(FINISH_MIN_MS, FINISH_MAX_MS, naturalDuration)),
    );

    unlocking.current = true;
    pointerActive.current = false;
    startY.current = null;
    suppressNextFiveClick.current = true;

    screen?.classList.remove("is-dragging", "is-returning");
    screen?.classList.add("is-unlocking");

    if (screen) {
      screen.style.transition = `transform ${duration}ms cubic-bezier(.22,1,.36,1)`;
    }
    if (underlay) {
      underlay.style.transition =
        `transform ${duration}ms cubic-bezier(.22,1,.36,1), opacity ${Math.min(duration, 240)}ms ease-out`;
    }

    applyOffset(currentOffset.current);
    if (screen) void screen.offsetHeight;

    window.requestAnimationFrame(() => {
      applyOffset(targetOffset);
    });

    clearPhaseTimer();
    phaseTimer.current = window.setTimeout(() => {
      underlayRef.current?.style.removeProperty("transition");
      underlayRef.current?.style.removeProperty("transform");
      underlayRef.current?.style.removeProperty("opacity");
      onUnlock();
    }, duration + 18);
  }, [applyOffset, clearFrame, clearPhaseTimer, onUnlock]);

  useEffect(() => {
    if (enabled) return;

    pointerActive.current = false;
    unlocking.current = false;
    startY.current = null;
    currentOffset.current = 0;
    pendingOffset.current = 0;
    upwardVelocity.current = 0;
    suppressNextFiveClick.current = false;

    clearFrame();
    clearPhaseTimer();
    screenRef.current?.classList.remove("is-dragging", "is-returning", "is-unlocking");
    resetInlineMotion();
  }, [clearFrame, clearPhaseTimer, enabled, resetInlineMotion]);

  useEffect(() => {
    return () => {
      clearFrame();
      clearPhaseTimer();
      resetInlineMotion();
    };
  }, [clearFrame, clearPhaseTimer, resetInlineMotion]);

  const onFivePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!enabled || unlocking.current) return;

    clearFrame();
    clearPhaseTimer();

    const screen = screenRef.current;
    const underlay = underlayRef.current;
    screen?.classList.remove("is-returning", "is-unlocking");
    screen?.classList.add("is-dragging");
    if (screen) screen.style.transition = "none";
    if (underlay) underlay.style.transition = "none";

    const now = performance.now();
    const pointerY = Math.max(1, event.clientY);

    pointerActive.current = true;
    startY.current = pointerY;
    // "Full swipe" is the available path from the digit to the top edge.
    // The distance threshold is evaluated on release together with velocity.
    unlockThreshold.current = Math.max(96, pointerY * UNLOCK_PROGRESS);
    viewportHeight.current = Math.max(360, window.innerHeight);
    currentOffset.current = 0;
    pendingOffset.current = 0;
    lastMoveOffset.current = 0;
    lastMoveAt.current = now;
    upwardVelocity.current = 0;
    suppressNextFiveClick.current = false;

    applyOffset(0);
    notifyNativeSnapshotRequest();

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic browser-test events may not own an active pointer.
    }
  }, [applyOffset, clearFrame, clearPhaseTimer, enabled]);

  const onFivePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!enabled || !pointerActive.current || startY.current === null || unlocking.current) return;

    const upwardDistance = Math.max(0, startY.current - event.clientY);
    const nextOffset = Math.min(
      viewportHeight.current + OFFSCREEN_OVERSHOOT_PX,
      upwardDistance,
    );

    const now = performance.now();
    const dt = now - lastMoveAt.current;
    if (dt > 0) {
      const instantVelocity = (nextOffset - lastMoveOffset.current) / dt;
      upwardVelocity.current =
        upwardVelocity.current * 0.65 + instantVelocity * 0.35;
    }
    lastMoveAt.current = now;
    lastMoveOffset.current = nextOffset;

    queueOffset(nextOffset);
    if (nextOffset > CLICK_SUPPRESS_PX) event.preventDefault();
  }, [enabled, queueOffset]);

  const onFivePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!enabled || !pointerActive.current || unlocking.current) return;

    pointerActive.current = false;
    startY.current = null;

    const velocityAge = performance.now() - lastMoveAt.current;
    const releaseVelocity =
      velocityAge <= VELOCITY_STALE_MS ? upwardVelocity.current : 0;
    const projectedOffset =
      currentOffset.current + Math.max(0, releaseVelocity) * RELEASE_PROJECTION_MS;
    const crossedDistanceThreshold =
      currentOffset.current >= unlockThreshold.current;
    const projectedPastThreshold =
      releaseVelocity >= FLICK_MIN_VELOCITY_PX_PER_MS &&
      projectedOffset >= unlockThreshold.current;

    if (crossedDistanceThreshold || projectedPastThreshold) {
      event.preventDefault();
      animateUnlock();
      return;
    }

    suppressNextFiveClick.current = currentOffset.current > CLICK_SUPPRESS_PX;
    if (currentOffset.current > 0) {
      animateReturn();
    } else {
      screenRef.current?.classList.remove("is-dragging");
      resetInlineMotion();
    }
  }, [animateReturn, animateUnlock, enabled, resetInlineMotion]);

  const consumeFiveClick = useCallback(() => {
    if (!suppressNextFiveClick.current) return false;
    suppressNextFiveClick.current = false;
    return true;
  }, []);

  const cancel = useCallback(() => {
    if (unlocking.current) return;

    pointerActive.current = false;
    startY.current = null;
    suppressNextFiveClick.current = currentOffset.current > CLICK_SUPPRESS_PX;

    if (currentOffset.current > 0) {
      animateReturn();
    } else {
      screenRef.current?.classList.remove("is-dragging");
      resetInlineMotion();
    }
  }, [animateReturn, resetInlineMotion]);

  return {
    setScreenElement,
    onFivePointerDown,
    onFivePointerMove,
    onFivePointerUp,
    consumeFiveClick,
    cancel,
  };
}

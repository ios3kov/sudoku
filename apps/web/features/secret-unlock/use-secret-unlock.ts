"use client";

import { useCallback, useEffect, useRef } from "react";
import { triggerNativeHaptic } from "./native-haptics";
import { captureNativeSudokuSnapshot } from "../sudoku/native-surface-theme";
import {
  SECRET_REVEAL_ARM_DELAY_MS,
  SECRET_REVEAL_CLICK_SUPPRESS_PX,
  shouldCancelBeforeArm,
  shouldCommitReveal,
} from "./secret-unlock-motion";

const UNLOCK_PROGRESS = 0.5;
const RETURN_MS = 300;
const FINISH_MIN_MS = 220;
const FINISH_MAX_MS = 360;
const PRIVATE_REVEAL_DISTANCE_PX = 220;
const OFFSCREEN_OVERSHOOT_PX = 28;
const VELOCITY_FRESH_MS = 120;

function motionDuration(defaultMs: number): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 20 : defaultMs;
}

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

interface SecretUnlockOptions {
  onUnlock: () => void;
}

export function useSecretUnlock({ onUnlock }: SecretUnlockOptions) {
  const screenRef = useRef<HTMLElement | null>(null);
  const underlayRef = useRef<HTMLElement | null>(null);
  const pointerActive = useRef(false);
  const armed = useRef(false);
  const cancelledBeforeArm = useRef(false);
  const unlocking = useRef(false);
  const startX = useRef<number | null>(null);
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
  const armTimer = useRef<number | null>(null);

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

  const clearArmTimer = useCallback(() => {
    if (armTimer.current !== null) {
      window.clearTimeout(armTimer.current);
      armTimer.current = null;
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
    if (unlocking.current) return;

    clearFrame();
    clearArmTimer();

    const screen = screenRef.current;
    const underlay = underlayRef.current;
    const targetOffset = Math.max(360, viewportHeight.current) + OFFSCREEN_OVERSHOOT_PX;
    const remainingRatio = clamp(
      0,
      1,
      (targetOffset - currentOffset.current) / Math.max(1, targetOffset),
    );
    const velocityBonus = clamp(0, 90, upwardVelocity.current * 65);
    const naturalDuration = 220 + remainingRatio * 140 - velocityBonus;
    const duration = motionDuration(
      Math.round(clamp(FINISH_MIN_MS, FINISH_MAX_MS, naturalDuration)),
    );

    unlocking.current = true;
    pointerActive.current = false;
    armed.current = false;
    startX.current = null;
    startY.current = null;
    suppressNextFiveClick.current = true;

    screen?.classList.remove("is-dragging", "is-returning");
    screen?.classList.add("is-unlocking");

    if (screen) {
      screen.style.transition = `transform ${duration}ms cubic-bezier(.16,1,.3,1)`;
    }
    if (underlay) {
      underlay.style.transition =
        `transform ${duration}ms cubic-bezier(.16,1,.3,1), opacity ${Math.min(duration, 220)}ms ease-out`;
    }

    applyOffset(currentOffset.current);
    if (screen) void screen.offsetHeight;

    triggerNativeHaptic("impact");
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
  }, [applyOffset, clearArmTimer, clearFrame, clearPhaseTimer, onUnlock]);

  useEffect(() => {
    return () => {
      clearFrame();
      clearArmTimer();
      clearPhaseTimer();
      resetInlineMotion();
    };
  }, [clearArmTimer, clearFrame, clearPhaseTimer, resetInlineMotion]);

  const onFivePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (unlocking.current) return;

    clearFrame();
    clearArmTimer();
    clearPhaseTimer();

    screenRef.current?.classList.remove("is-returning", "is-unlocking", "is-dragging");
    resetInlineMotion();

    captureNativeSudokuSnapshot();

    const now = performance.now();
    const pointerX = event.clientX;
    const pointerY = Math.max(1, event.clientY);

    pointerActive.current = true;
    armed.current = false;
    cancelledBeforeArm.current = false;
    startX.current = pointerX;
    startY.current = pointerY;
    unlockThreshold.current = Math.max(96, pointerY * UNLOCK_PROGRESS);
    viewportHeight.current = Math.max(360, window.innerHeight);
    currentOffset.current = 0;
    pendingOffset.current = 0;
    lastMoveOffset.current = 0;
    lastMoveAt.current = now;
    upwardVelocity.current = 0;
    suppressNextFiveClick.current = false;

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic browser-test events may not own an active pointer.
    }

    armTimer.current = window.setTimeout(() => {
      armTimer.current = null;
      if (!pointerActive.current || cancelledBeforeArm.current || unlocking.current) return;
      armed.current = true;

      const screen = screenRef.current;
      const underlay = underlayRef.current;
      screen?.classList.add("is-dragging");
      if (screen) screen.style.transition = "none";
      if (underlay) underlay.style.transition = "none";
      applyOffset(0);
      triggerNativeHaptic("selection");
    }, SECRET_REVEAL_ARM_DELAY_MS);
  }, [applyOffset, clearArmTimer, clearFrame, clearPhaseTimer, resetInlineMotion]);

  const onFivePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerActive.current || startY.current === null || startX.current === null || unlocking.current) return;

    if (!armed.current) {
      if (shouldCancelBeforeArm(
        event.clientX - startX.current,
        event.clientY - startY.current,
      )) {
        cancelledBeforeArm.current = true;
        clearArmTimer();
        suppressNextFiveClick.current = true;
      }
      return;
    }

    const upwardDistance = Math.max(0, startY.current - event.clientY);
    const nextOffset = Math.min(
      viewportHeight.current + OFFSCREEN_OVERSHOOT_PX,
      upwardDistance,
    );

    const now = performance.now();
    const dt = now - lastMoveAt.current;
    if (dt > 0) {
      const instantVelocity = (nextOffset - lastMoveOffset.current) / dt;
      upwardVelocity.current = Math.max(
        0,
        upwardVelocity.current * 0.65 + instantVelocity * 0.35,
      );
    }
    lastMoveAt.current = now;
    lastMoveOffset.current = nextOffset;

    if (nextOffset > 0) event.preventDefault();
    queueOffset(nextOffset);
  }, [clearArmTimer, queueOffset]);

  const onFivePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerActive.current || unlocking.current) return;

    clearArmTimer();
    pointerActive.current = false;

    if (!armed.current) {
      armed.current = false;
      startX.current = null;
      startY.current = null;
      return;
    }

    const releaseVelocity =
      performance.now() - lastMoveAt.current <= VELOCITY_FRESH_MS
        ? upwardVelocity.current
        : 0;

    armed.current = false;
    startX.current = null;
    startY.current = null;

    if (shouldCommitReveal(
      currentOffset.current,
      unlockThreshold.current,
      releaseVelocity,
    )) {
      event.preventDefault();
      animateUnlock();
      return;
    }

    suppressNextFiveClick.current = currentOffset.current > SECRET_REVEAL_CLICK_SUPPRESS_PX;
    if (currentOffset.current > 0) {
      animateReturn();
    } else {
      screenRef.current?.classList.remove("is-dragging");
      resetInlineMotion();
    }
  }, [animateReturn, animateUnlock, clearArmTimer, resetInlineMotion]);

  const consumeFiveClick = useCallback(() => {
    if (!suppressNextFiveClick.current) return false;
    suppressNextFiveClick.current = false;
    return true;
  }, []);

  const cancel = useCallback(() => {
    if (unlocking.current) return;

    clearArmTimer();
    pointerActive.current = false;
    armed.current = false;
    startX.current = null;
    startY.current = null;
    suppressNextFiveClick.current = currentOffset.current > SECRET_REVEAL_CLICK_SUPPRESS_PX;

    if (currentOffset.current > 0) {
      animateReturn();
    } else {
      screenRef.current?.classList.remove("is-dragging");
      resetInlineMotion();
    }
  }, [animateReturn, clearArmTimer, resetInlineMotion]);

  return {
    setScreenElement,
    onFivePointerDown,
    onFivePointerMove,
    onFivePointerUp,
    consumeFiveClick,
    cancel,
  };
}

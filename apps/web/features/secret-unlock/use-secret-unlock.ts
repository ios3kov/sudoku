"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  armFromFive,
  beginSwipe,
  createGestureState,
  finishSwipe,
  type GestureState,
} from "@sudoku/domain";

const UNLOCK_DISTANCE_PX = 80;
const MAX_VISUAL_DRAG_PX = 120;
const UNLOCK_FINISH_MS = 150;

export function useSecretUnlock(onUnlock: () => void) {
  const state = useRef<GestureState>(createGestureState());
  const pointerActive = useRef(false);
  const startY = useRef<number | null>(null);
  const suppressNextFiveClick = useRef(false);
  const unlockTimer = useRef<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    return () => {
      if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current);
    };
  }, []);

  const onFivePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (unlocking) return;

    const now = performance.now();
    const armed = armFromFive(createGestureState(), now);
    state.current = beginSwipe(
      armed,
      { x: event.clientX, y: event.clientY },
      now,
    );
    pointerActive.current = true;
    startY.current = event.clientY;
    suppressNextFiveClick.current = false;
    setDragOffsetY(0);
    setDragging(true);

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic test events may not register an active pointer.
    }
  }, [unlocking]);

  const onFivePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerActive.current || startY.current === null) return;
    const upwardDistance = Math.max(0, startY.current - event.clientY);
    setDragOffsetY(Math.min(MAX_VISUAL_DRAG_PX, upwardDistance));
  }, []);

  const resetVisual = useCallback(() => {
    pointerActive.current = false;
    startY.current = null;
    setDragging(false);
    setUnlocking(false);
    setDragOffsetY(0);
  }, []);

  const onFivePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!pointerActive.current) return;

      const result = finishSwipe(
        state.current,
        { x: event.clientX, y: event.clientY },
        performance.now(),
      );
      state.current = result.state;
      pointerActive.current = false;
      startY.current = null;
      setDragging(false);

      if (!result.unlocked) {
        setDragOffsetY(0);
        return;
      }

      suppressNextFiveClick.current = true;
      setUnlocking(true);
      setDragOffsetY(MAX_VISUAL_DRAG_PX);
      event.preventDefault();

      if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current);
      unlockTimer.current = window.setTimeout(() => {
        setUnlocking(false);
        setDragOffsetY(0);
        onUnlock();
      }, UNLOCK_FINISH_MS);
    },
    [onUnlock],
  );

  const consumeFiveClick = useCallback(() => {
    if (!suppressNextFiveClick.current) return false;
    suppressNextFiveClick.current = false;
    return true;
  }, []);

  const cancel = useCallback(() => {
    state.current = createGestureState();
    suppressNextFiveClick.current = false;
    if (unlockTimer.current !== null) {
      window.clearTimeout(unlockTimer.current);
      unlockTimer.current = null;
    }
    resetVisual();
  }, [resetVisual]);

  return {
    onFivePointerDown,
    onFivePointerMove,
    onFivePointerUp,
    consumeFiveClick,
    cancel,
    dragOffsetY,
    progress: Math.min(1, dragOffsetY / UNLOCK_DISTANCE_PX),
    dragging,
    unlocking,
    active: dragging || unlocking,
  };
}

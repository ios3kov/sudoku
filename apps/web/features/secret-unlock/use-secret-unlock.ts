"use client";

import { useCallback, useRef } from "react";
import {
  armFromFive,
  beginSwipe,
  createGestureState,
  finishSwipe,
  type GestureState,
} from "@sudoku/domain";

export function useSecretUnlock(onUnlock: () => void) {
  const state = useRef<GestureState>(createGestureState());

  const arm = useCallback(() => {
    state.current = armFromFive(state.current, performance.now());
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    state.current = beginSwipe(
      state.current,
      { x: event.clientX, y: event.clientY },
      performance.now(),
    );
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const result = finishSwipe(
        state.current,
        { x: event.clientX, y: event.clientY },
        performance.now(),
      );
      state.current = result.state;
      if (result.unlocked) onUnlock();
    },
    [onUnlock],
  );

  const cancel = useCallback(() => {
    state.current = createGestureState();
  }, []);

  return { arm, onPointerDown, onPointerUp, cancel };
}

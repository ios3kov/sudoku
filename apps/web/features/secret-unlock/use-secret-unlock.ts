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

  const onFivePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const now = performance.now();
    const armed = armFromFive(createGestureState(), now);
    state.current = beginSwipe(
      armed,
      { x: event.clientX, y: event.clientY },
      now,
    );
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onFivePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const result = finishSwipe(
        state.current,
        { x: event.clientX, y: event.clientY },
        performance.now(),
      );
      state.current = result.state;
      if (result.unlocked) {
        event.preventDefault();
        onUnlock();
      }
    },
    [onUnlock],
  );

  const cancel = useCallback(() => {
    state.current = createGestureState();
  }, []);

  return { onFivePointerDown, onFivePointerUp, cancel };
}

export interface Point {
  x: number;
  y: number;
}

export interface GestureConfig {
  armWindowMs: number;
  maxSwipeMs: number;
  minUpDistancePx: number;
  maxHorizontalDriftPx: number;
}

export interface GestureState {
  armedUntil: number;
  pointerStart: (Point & { at: number }) | null;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  armWindowMs: 1200,
  maxSwipeMs: 700,
  minUpDistancePx: 80,
  maxHorizontalDriftPx: 55,
};

export function createGestureState(): GestureState {
  return { armedUntil: 0, pointerStart: null };
}

export function armFromFive(
  state: GestureState,
  now: number,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): GestureState {
  return {
    armedUntil: now + config.armWindowMs,
    pointerStart: null,
  };
}

export function beginSwipe(state: GestureState, point: Point, now: number): GestureState {
  if (now > state.armedUntil) return createGestureState();
  return {
    ...state,
    pointerStart: { ...point, at: now },
  };
}

export function finishSwipe(
  state: GestureState,
  point: Point,
  now: number,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): { state: GestureState; unlocked: boolean } {
  const start = state.pointerStart;
  if (!start || now > state.armedUntil) {
    return { state: createGestureState(), unlocked: false };
  }

  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const duration = now - start.at;
  const unlocked =
    duration >= 0 &&
    duration <= config.maxSwipeMs &&
    dy <= -config.minUpDistancePx &&
    Math.abs(dx) <= config.maxHorizontalDriftPx;

  return { state: createGestureState(), unlocked };
}

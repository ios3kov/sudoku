export const SECRET_REVEAL_ARM_DELAY_MS = 90;
export const SECRET_REVEAL_PREARM_SLOP_PX = 18;
export const SECRET_REVEAL_CLICK_SUPPRESS_PX = 12;
export const SECRET_REVEAL_PROJECTION_MS = 180;

export function shouldCancelBeforeArm(deltaX: number, deltaY: number): boolean {
  return Math.hypot(deltaX, deltaY) > SECRET_REVEAL_PREARM_SLOP_PX;
}

export function projectedRevealOffset(
  offset: number,
  upwardVelocityPxPerMs: number,
): number {
  return Math.max(
    0,
    offset + Math.max(0, upwardVelocityPxPerMs) * SECRET_REVEAL_PROJECTION_MS,
  );
}

export function shouldCommitReveal(
  offset: number,
  threshold: number,
  upwardVelocityPxPerMs: number,
): boolean {
  return projectedRevealOffset(offset, upwardVelocityPxPerMs) >= threshold;
}

export function revealCompletionDurationMs(
  remainingPx: number,
  upwardVelocityPxPerMs: number,
): number {
  const distance = Math.max(0, remainingPx);
  const velocity = Math.max(0, upwardVelocityPxPerMs);
  const projectedSpeed = Math.max(0.45, velocity);
  const travelMs = distance / projectedSpeed;
  return Math.round(Math.min(340, Math.max(180, travelMs * 0.42)));
}

export const SECRET_REVEAL_ARM_DELAY_MS = 90;
export const SECRET_REVEAL_PREARM_SLOP_PX = 18;
export const SECRET_REVEAL_CLICK_SUPPRESS_PX = 12;
export const SECRET_REVEAL_VELOCITY_COMMIT_PX_PER_MS = 0.55;
export const SECRET_REVEAL_MIN_VELOCITY_COMMIT_PX = 72;

export function shouldCancelBeforeArm(deltaX: number, deltaY: number): boolean {
  return Math.hypot(deltaX, deltaY) > SECRET_REVEAL_PREARM_SLOP_PX;
}

export function shouldCommitReveal(
  offset: number,
  threshold: number,
  upwardVelocityPxPerMs: number,
): boolean {
  return offset >= threshold
    || (
      offset >= SECRET_REVEAL_MIN_VELOCITY_COMMIT_PX
      && upwardVelocityPxPerMs >= SECRET_REVEAL_VELOCITY_COMMIT_PX_PER_MS
    );
}

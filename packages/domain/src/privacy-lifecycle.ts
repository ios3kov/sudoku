export const DEFAULT_PRIVATE_LOCK_MS = 30_000;

export function shouldLockPrivateSurface(
  hiddenAt: number | null,
  resumedAt: number,
  thresholdMs = DEFAULT_PRIVATE_LOCK_MS,
): boolean {
  if (hiddenAt === null) return false;
  if (!Number.isFinite(hiddenAt) || !Number.isFinite(resumedAt)) return true;
  if (!Number.isFinite(thresholdMs) || thresholdMs < 0) return true;

  return resumedAt - hiddenAt >= thresholdMs;
}

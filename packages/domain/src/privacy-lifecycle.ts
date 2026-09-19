export const PRIVATE_BACKGROUND_LOCK_MS = 30_000;
export function shouldLockPrivateSurface(hiddenAt:number|null,now:number,threshold=PRIVATE_BACKGROUND_LOCK_MS):boolean {
  if (hiddenAt===null || !Number.isFinite(hiddenAt) || !Number.isFinite(now) || now<hiddenAt) return hiddenAt!==null;
  return now-hiddenAt>=threshold;
}

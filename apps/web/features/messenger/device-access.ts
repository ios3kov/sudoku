/** The PIN and unlock capability are never written to browser storage. */
export const DEVICE_LOCK_EVENT = "sudoku:device-locked";
export const DEVICE_UNLOCK_EVENT = "sudoku:device-unlocked";
export const UNLOCK_HEADER = "X-Sudoku-Unlock";
const EMAIL_KEY = "sudoku.remembered-email.v1";
const PHONE_KEY = "sudoku.remembered-phone.v1";
let unlockToken: string | null = null;
let epoch = 0;

export function accessEpoch(): number { return epoch; }
export function currentUnlockToken(): string | null { return unlockToken; }

export function acceptUnlock(token: unknown, expectedEpoch: number): boolean {
  if (expectedEpoch !== epoch || typeof token !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return false;
  unlockToken = token;
  if (typeof window !== "undefined") window.dispatchEvent?.(new Event(DEVICE_UNLOCK_EVENT));
  return true;
}

export function forgetUnlock(): void { unlockToken = null; epoch += 1; }

export function requireDevicePin(): void {
  forgetUnlock();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEVICE_LOCK_EVENT));
}

export function lockDevice(): void {
  const previous = unlockToken;
  forgetUnlock();
  if (previous) {
    // The server only invalidates this exact ticket, never a newer unlock.
    void globalThis.fetch("/v1/auth/device-access/lock", {
      method: "POST", credentials: "include", cache: "no-store", keepalive: true,
      headers: { [UNLOCK_HEADER]: previous },
    }).catch(() => undefined);
  }
}

export async function privateFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Keep capabilities off presigned object-store requests and third-party URLs.
  const path = typeof input === "string" ? input : "";
  if (!path.startsWith("/v1/")) return globalThis.fetch(input, init);
  const started = epoch;
  const requestToken = unlockToken;
  const headers = new Headers(init?.headers);
  if (requestToken) headers.set(UNLOCK_HEADER, requestToken);
  const content = /^\/v1\/assets\/([a-f0-9-]+)\/content$/.exec(path);
  if (content && requestToken) {
    const link = await resolveAssetLink(content[1], init?.signal ?? undefined);
    if (started !== epoch) throw new DOMException("Device locked", "AbortError");
    // New request, with no custom header or cookies carried across origins.
    const contentResponse = await globalThis.fetch(link, { signal: init?.signal, credentials: "omit", cache: "no-store", redirect: "error" });
    if (started !== epoch) throw new DOMException("Device locked", "AbortError");
    return contentResponse;
  }
  const response = await globalThis.fetch(input, { ...init, headers, ...(requestToken ? { redirect: "error" as const } : {}) });
  if (started !== epoch) throw new DOMException("Device locked", "AbortError");
  if (response.status === 423 && started === epoch) {
    if (requestToken === unlockToken) requireDevicePin();
    // A stale rejection cannot lock a newer successful unlock.
    // Lock is retryable, not a permanent message rejection. Existing outbox
    // clients must never discard a queued message because its tab was locked.
    throw new DOMException("Device locked", "AbortError");
  }
  return response;
}


export function savedPhone(): string {
  try {
    const value = localStorage.getItem(PHONE_KEY) ?? "";
    return /^\+[1-9][0-9]{7,14}$/.test(value) ? value : "";
  } catch { return ""; }
}

export function rememberPhone(phone: string, remember: boolean): boolean {
  try {
    if (!remember) localStorage.removeItem(PHONE_KEY);
    else {
      const value = phone.replace(/[\s().-]+/g, "");
      if (!/^\+[1-9][0-9]{7,14}$/.test(value)) return false;
      localStorage.setItem(PHONE_KEY, value);
    }
    return true;
  } catch { return false; }
}

export function savedEmail(): string {
  try {
    const value = localStorage.getItem(EMAIL_KEY) ?? "";
    return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
  } catch { return ""; }
}

export function rememberEmail(email: string, remember: boolean): boolean {
  try {
    if (!remember) localStorage.removeItem(EMAIL_KEY);
    else {
      const value = email.trim();
      if (value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
      localStorage.setItem(EMAIL_KEY, value);
    }
    return true;
  } catch { return false; }
}

export async function resolveAssetLink(assetId: string, signal?: AbortSignal): Promise<string> {
  if (!/^[a-f0-9-]{36}$/.test(assetId)) throw new Error("Invalid asset identity");
  const response = await privateFetch(`/v1/assets/${assetId}/download-url`, { credentials: "include", cache: "no-store", signal });
  if (!response.ok) throw new Error("Unable to access attachment");
  const { url } = await response.json() as { url: string };
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new Error("Invalid attachment link");
  return url;
}

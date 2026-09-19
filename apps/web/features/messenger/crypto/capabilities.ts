export interface BrowserCryptoCapabilities {
  secureContext: boolean;
  webCrypto: boolean;
  indexedDb: boolean;
  randomValues: boolean;
}

export function getBrowserCryptoCapabilities(): BrowserCryptoCapabilities {
  const cryptoObject = typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto;
  return {
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    webCrypto: Boolean(cryptoObject?.subtle),
    indexedDb: typeof indexedDB !== "undefined",
    randomValues: typeof cryptoObject?.getRandomValues === "function",
  };
}

export function assertBrowserCryptoCapabilities(): void {
  const capabilities = getBrowserCryptoCapabilities();
  const missing = Object.entries(capabilities)
    .filter(([, supported]) => !supported)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Browser cannot provide required E2EE primitives: ${missing.join(", ")}`);
  }
}

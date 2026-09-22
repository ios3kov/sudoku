/** Conceal synchronously: IndexedDB cleanup can fail or wait on another tab. */
export function concealRevokedSession({ conceal, clearProtocol, clearOutbox }: {
  conceal: () => void;
  clearProtocol: () => Promise<void>;
  clearOutbox: () => Promise<void>;
}): Promise<void> {
  conceal();
  return Promise.allSettled([
    Promise.resolve().then(clearProtocol),
    Promise.resolve().then(clearOutbox),
  ]).then(() => undefined);
}

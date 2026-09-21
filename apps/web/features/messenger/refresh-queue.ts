type RefreshTask = () => Promise<void>;

/**
 * Serialize refreshes, retaining the latest notification received while busy.
 * Every caller waits for the complete drain, not an already-started stale pass.
 * Tasks handle recoverable sync failures; an unexpected rejection ends this
 * drain, releases the queue and is propagated to its callers.
 */
export function createRefreshQueue(): (work: RefreshTask) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let pending: RefreshTask | null = null;

  return (work) => {
    pending = work;
    if (inFlight) return inFlight;

    // Start in a microtask so the in-flight promise is installed even when a
    // task throws synchronously or requests another refresh before awaiting.
    inFlight = Promise.resolve().then(async () => {
      try {
        while (pending) {
          const next = pending;
          pending = null;
          await next();
        }
      } finally {
        pending = null;
        inFlight = null;
      }
    });
    return inFlight;
  };
}

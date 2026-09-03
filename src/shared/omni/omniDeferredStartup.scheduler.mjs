export const OMNI_DEFERRED_STARTUP_GRACE_MS = 16;

export const scheduleOmniDeferredStartup = (
  callback,
  {
    delayMs = OMNI_DEFERRED_STARTUP_GRACE_MS,
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
  } = {},
) => {
  let pending = true;
  const handle = setTimer(() => {
    if (!pending) return;
    pending = false;
    callback();
  }, delayMs);
  return () => {
    if (!pending) return false;
    pending = false;
    clearTimer(handle);
    return true;
  };
};

export const createOmniDeferredStartupRegistry = (schedule = scheduleOmniDeferredStartup) => {
  const cancels = new Map();
  return Object.freeze({
    schedule(key, callback) {
      if (cancels.has(key)) return false;
      let cancel;
      cancel = schedule(() => {
        if (cancels.get(key) !== cancel) return;
        cancels.delete(key);
        callback();
      });
      cancels.set(key, cancel);
      return true;
    },
    cancelAll() {
      for (const cancel of cancels.values()) cancel();
      cancels.clear();
    },
  });
};

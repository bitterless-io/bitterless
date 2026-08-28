import { watch } from 'node:fs';

import { WATCH_TRAILING_MS } from './constants.mjs';

const MAX_RECONCILE_RETRY_MS = 30_000;

export const createWorkspaceWatchController = ({
  rootPath,
  onReconcile,
  onError,
  watchFactory = watch,
  fallbackIntervalMs = 30_000,
  retryBaseMs = 1_000,
  retryMaxMs = 30_000
}) => {
  const normalizedFallbackIntervalMs = Number.isFinite(fallbackIntervalMs)
    ? Math.max(1, fallbackIntervalMs)
    : 30_000;
  const normalizedRetryBaseMs = Math.min(
    MAX_RECONCILE_RETRY_MS,
    Number.isFinite(retryBaseMs) ? Math.max(1, retryBaseMs) : 1_000
  );
  const normalizedRetryMaxMs = Math.min(
    MAX_RECONCILE_RETRY_MS,
    Number.isFinite(retryMaxMs)
      ? Math.max(normalizedRetryBaseMs, retryMaxMs)
      : MAX_RECONCILE_RETRY_MS
  );
  const pendingPaths = new Set();
  const pendingRenamePaths = new Set();
  let fullReconcile = false;
  let retryFullReconcile = false;
  let trailingTimer;
  let reconcileRetryTimer;
  let watcherRetryTimer;
  let fallbackTimer;
  let watcherRetryAttempt = 0;
  let reconcileRetryAttempt = 0;
  let fallbackEligible = false;
  let recoveryReconcileNeeded = false;
  let closed = false;
  let running = Promise.resolve();
  let reconcileRunning = false;
  let watcher;

  const clearTrailingTimer = () => {
    clearTimeout(trailingTimer);
    trailingTimer = undefined;
  };

  const clearReconcileRetryTimer = () => {
    clearTimeout(reconcileRetryTimer);
    reconcileRetryTimer = undefined;
  };

  const clearWatcherRetryTimer = () => {
    clearTimeout(watcherRetryTimer);
    watcherRetryTimer = undefined;
  };

  const clearFallbackTimer = () => {
    clearTimeout(fallbackTimer);
    fallbackTimer = undefined;
  };

  const reportError = (error) => {
    try {
      onError?.(error);
    } catch {
      // Error reporting must not break watcher or reconcile recovery.
    }
  };

  const schedule = () => {
    if (closed || retryFullReconcile) return;
    clearTrailingTimer();
    trailingTimer = setTimeout(flush, WATCH_TRAILING_MS);
    trailingTimer.unref?.();
  };

  const scheduleReconcileRetry = () => {
    if (closed || reconcileRetryTimer) return;
    const delayMs = Math.min(
      normalizedRetryMaxMs,
      normalizedRetryBaseMs * 2 ** Math.min(reconcileRetryAttempt, 30)
    );
    reconcileRetryAttempt = Math.min(reconcileRetryAttempt + 1, 30);
    reconcileRetryTimer = setTimeout(() => {
      reconcileRetryTimer = undefined;
      flush();
    }, delayMs);
    reconcileRetryTimer.unref?.();
  };

  const scheduleFallback = () => {
    if (closed || watcher || fallbackTimer || !fallbackEligible) return;
    fallbackTimer = setTimeout(() => {
      fallbackTimer = undefined;
      if (closed || watcher || !fallbackEligible) return;
      if (reconcileRunning || (retryFullReconcile && reconcileRetryTimer)) {
        running.finally(() => scheduleFallback());
        return;
      }
      fallbackEligible = false;
      fullReconcile = true;
      flush();
    }, normalizedFallbackIntervalMs);
    fallbackTimer.unref?.();
  };

  const flush = ({ force = false } = {}) => {
    if (closed || reconcileRunning) return;
    if (retryFullReconcile && reconcileRetryTimer && !force) return;
    clearTrailingTimer();
    if (force) clearReconcileRetryTimer();
    const paths = [...pendingPaths];
    const renamePaths = [...pendingRenamePaths].filter((path) => pendingPaths.has(path));
    const full = fullReconcile || retryFullReconcile;
    if (!full && paths.length === 0) return;
    pendingPaths.clear();
    pendingRenamePaths.clear();
    fullReconcile = false;
    reconcileRunning = true;
    const reconcileChange = renamePaths.length > 0 ? { full, paths, renamePaths } : { full, paths };
    running = Promise.resolve()
      .then(() => onReconcile(reconcileChange))
      .then(
        () => {
          if (!full) return;
          retryFullReconcile = false;
          reconcileRetryAttempt = 0;
          clearReconcileRetryTimer();
        },
        (error) => {
          reportError(error);
          if (closed) return;
          retryFullReconcile = true;
          clearTrailingTimer();
          scheduleReconcileRetry();
        }
      )
      .finally(() => {
        reconcileRunning = false;
        if (closed) return;
        if (retryFullReconcile) {
          scheduleReconcileRetry();
        } else if (fullReconcile || pendingPaths.size > 0) {
          schedule();
        }
        scheduleFallback();
      });
  };

  const scheduleWatcherRetry = () => {
    if (closed || watcher || watcherRetryTimer) return;
    const delayMs = Math.min(
      normalizedRetryMaxMs,
      normalizedRetryBaseMs * 2 ** Math.min(watcherRetryAttempt, 30)
    );
    watcherRetryAttempt = Math.min(watcherRetryAttempt + 1, 30);
    watcherRetryTimer = setTimeout(() => {
      watcherRetryTimer = undefined;
      attachWatcher();
    }, delayMs);
    watcherRetryTimer.unref?.();
  };

  const markWatcherUnavailable = (error, failedWatcher) => {
    if (failedWatcher && watcher !== failedWatcher) return;
    if (failedWatcher) {
      watcher = undefined;
      failedWatcher.close?.();
    }
    reportError(error);
    fallbackEligible = true;
    recoveryReconcileNeeded = true;
    scheduleFallback();
    scheduleWatcherRetry();
  };

  const attachWatcher = () => {
    if (closed || watcher) return;
    let attachedWatcher;
    try {
      attachedWatcher = watchFactory(rootPath, { recursive: true }, (eventType, filename) => {
        if (closed || (attachedWatcher && watcher !== attachedWatcher)) return;
        if (filename === null) {
          fullReconcile = true;
        } else {
          const relativePath = String(filename).replaceAll('\\', '/');
          pendingPaths.add(relativePath);
          if (eventType === 'rename') pendingRenamePaths.add(relativePath);
        }
        schedule();
      });
      if (!attachedWatcher || typeof attachedWatcher.on !== 'function') {
        throw new TypeError('Recursive watch did not return an event source');
      }
      watcher = attachedWatcher;
      attachedWatcher.on('error', (error) => markWatcherUnavailable(error, attachedWatcher));
      watcherRetryAttempt = 0;
      clearWatcherRetryTimer();
      clearFallbackTimer();
      fallbackEligible = false;
      if (recoveryReconcileNeeded) {
        recoveryReconcileNeeded = false;
        fullReconcile = true;
        schedule();
      }
    } catch (error) {
      attachedWatcher?.close?.();
      markWatcherUnavailable(error);
    }
  };

  attachWatcher();

  return {
    requestFullReconcile() {
      fullReconcile = true;
      schedule();
    },
    async flushNow() {
      clearTrailingTimer();
      flush({ force: true });
      await running;
    },
    async close({ drain = true } = {}) {
      closed = true;
      clearTrailingTimer();
      clearReconcileRetryTimer();
      clearWatcherRetryTimer();
      clearFallbackTimer();
      const activeWatcher = watcher;
      watcher = undefined;
      activeWatcher?.close?.();
      if (drain) await running;
      retryFullReconcile = false;
      fallbackEligible = false;
      recoveryReconcileNeeded = false;
    },
    mode() {
      return watcher ? 'watch' : 'fallback-reconcile';
    }
  };
};

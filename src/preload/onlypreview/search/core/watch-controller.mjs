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
  let timer;
  let retryTimer;
  let retryAttempt = 0;
  let closed = false;
  let running = Promise.resolve();
  let reconcileRunning = false;
  let watcher;
  let fallbackTimer;

  const clearTrailingTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const clearRetryTimer = () => {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  };

  const reportError = (error) => {
    try {
      onError?.(error);
    } catch {
      // Error reporting must not break the retry latch.
    }
  };

  const schedule = () => {
    if (closed || retryFullReconcile) return;
    clearTrailingTimer();
    timer = setTimeout(flush, WATCH_TRAILING_MS);
  };

  const scheduleRetry = () => {
    if (closed || retryTimer) return;
    const delayMs = Math.min(
      normalizedRetryMaxMs,
      normalizedRetryBaseMs * 2 ** Math.min(retryAttempt, 30)
    );
    retryAttempt = Math.min(retryAttempt + 1, 30);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      flush();
    }, delayMs);
    retryTimer.unref?.();
  };

  const flush = ({ force = false } = {}) => {
    if (closed || reconcileRunning) return;
    if (retryFullReconcile && retryTimer && !force) return;
    clearTrailingTimer();
    if (force) clearRetryTimer();
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
          retryAttempt = 0;
          clearRetryTimer();
        },
        (error) => {
          reportError(error);
          if (closed) return;
          retryFullReconcile = true;
          clearTrailingTimer();
          scheduleRetry();
        }
      )
      .finally(() => {
        reconcileRunning = false;
        if (closed) return;
        if (retryFullReconcile) {
          scheduleRetry();
        } else if (fullReconcile || pendingPaths.size > 0) {
          schedule();
        }
      });
  };

  const startFallback = () => {
    if (fallbackTimer || closed) return;
    fallbackTimer = setInterval(() => {
      fullReconcile = true;
      flush();
    }, fallbackIntervalMs);
    fallbackTimer.unref?.();
  };

  try {
    watcher = watchFactory(rootPath, { recursive: true }, (eventType, filename) => {
      if (filename === null) {
        fullReconcile = true;
      } else {
        const relativePath = String(filename).replaceAll('\\', '/');
        pendingPaths.add(relativePath);
        if (eventType === 'rename') pendingRenamePaths.add(relativePath);
      }
      schedule();
    });
    watcher.on('error', (error) => {
      fullReconcile = true;
      reportError(error);
      watcher?.close();
      watcher = undefined;
      startFallback();
      schedule();
    });
  } catch (error) {
    reportError(error);
    startFallback();
  }

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
      clearRetryTimer();
      clearInterval(fallbackTimer);
      watcher?.close();
      if (drain) await running;
      retryFullReconcile = false;
    },
    mode() {
      return watcher ? 'watch' : 'fallback-reconcile';
    }
  };
};

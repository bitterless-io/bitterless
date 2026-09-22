import { watch } from 'node:fs';

import { MAX_WATCH_CHANGE_PATHS, WATCH_TRAILING_MS } from './constants.mjs';
import { isWorkspaceConfigWatchPath } from './workspace-config.mjs';
import { REBUILD_REQUIRED } from './watch-reconciler.mjs';

const MAX_RECONCILE_RETRY_MS = 30_000;

// 一次全量 reconcile 结束后,至少静置 `上次全量耗时 × 这个倍数`,才允许下一次全量开始。
//
// 为什么需要它(Ral 2026-09-16,「巨卡,导致别的程序都受到影响」):全量 reconcile 的代价随工作区
// 大小走,而触发它的两条路都是**固定节奏**的 ——
//   · 无 watcher 时的兜底轮询固定 30s(`fallbackIntervalMs`);
//   · macOS 上 `fs.watch(recursive)` 事件队列溢出时,Node 送来 `filename === null`,本文件据此
//     直接升级成全量,而升级只隔一个 400ms 的尾抖动(`WATCH_TRAILING_MS`)。
// 于是在一棵大树上必然自激:实测 97,914 个文件的工作区,一轮 = 备份 10–16s + 遍历 42s + 提交 1.4s
// ≈ 60s,而排程只等 30s/0.4s → 上一轮刚落地下一轮就开跑。26 小时里跑了 238 轮全量,两个 renderer
// 进程长期占 30–120% CPU,整机被拖慢。
//
// 按**上次实际耗时**退避而不是调大固定间隔:小工作区一轮几百毫秒,冷却被 0 下限吃掉,行为不变;
// 只有大到会自激的工作区才会被拉开。索引是搜索的便利,不是正确性要求,晚几分钟新鲜是可接受的代价。
const FULL_RECONCILE_COOLDOWN_FACTOR = 4;
const MAX_FULL_RECONCILE_COOLDOWN_MS = 5 * 60_000;

export const createWorkspaceWatchController = ({
  rootPath,
  onReconcile,
  onBrowseChange,
  onError,
  onConfigChange,
  onConfigProbe,
  watchFactory = watch,
  fallbackIntervalMs = 30_000,
  retryBaseMs = 1_000,
  retryMaxMs = 30_000,
  fullReconcileCooldownFactor = FULL_RECONCILE_COOLDOWN_FACTOR,
  fullReconcileCooldownMaxMs = MAX_FULL_RECONCILE_COOLDOWN_MS
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
  const normalizedCooldownFactor = Number.isFinite(fullReconcileCooldownFactor)
    ? Math.max(0, fullReconcileCooldownFactor)
    : FULL_RECONCILE_COOLDOWN_FACTOR;
  const normalizedCooldownMaxMs = Number.isFinite(fullReconcileCooldownMaxMs)
    ? Math.max(0, fullReconcileCooldownMaxMs)
    : MAX_FULL_RECONCILE_COOLDOWN_MS;
  const pendingPaths = new Set();
  const pendingRenamePaths = new Set();
  const pendingBrowsePaths = new Set();
  let browseFull = false;
  let browseTimer;
  let browseRunning;
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
  let lastFullReconcileEndedAt = 0;
  let lastFullReconcileMs = 0;
  let cooldownTimer;

  const clearCooldownTimer = () => {
    clearTimeout(cooldownTimer);
    cooldownTimer = undefined;
  };

  /** 距离「下一次全量可以开始」还差多少毫秒;0 = 现在就可以。 */
  const fullReconcileCooldownRemainingMs = () => {
    if (!lastFullReconcileEndedAt) return 0;
    const cooldownMs = Math.min(
      normalizedCooldownMaxMs,
      lastFullReconcileMs * normalizedCooldownFactor
    );
    return Math.max(0, lastFullReconcileEndedAt + cooldownMs - Date.now());
  };

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

  // File names and visible rows must keep moving while a content reconcile is busy. Coalesce this
  // small metadata-only read independently; it never opens files or waits for the reconcile queue.
  const flushBrowse = () => {
    clearTimeout(browseTimer);
    browseTimer = undefined;
    if (closed || browseRunning || typeof onBrowseChange !== 'function') return;
    if (!browseFull && pendingBrowsePaths.size === 0) return;
    const change = { full: browseFull, paths: [...pendingBrowsePaths] };
    browseFull = false;
    pendingBrowsePaths.clear();
    browseRunning = Promise.resolve().then(() => onBrowseChange(change)).catch(reportError).finally(() => {
      browseRunning = undefined;
      if (!closed && (browseFull || pendingBrowsePaths.size)) scheduleBrowse();
    });
  };

  const scheduleBrowse = () => {
    if (closed || browseTimer || typeof onBrowseChange !== 'function') return;
    browseTimer = setTimeout(flushBrowse, 50);
    browseTimer.unref?.();
  };

  const probeConfig = () => {
    Promise.resolve().then(() => onConfigProbe?.()).catch(reportError);
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
      probeConfig();
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
    // 全量退避。`force`(flushNow)与失败重试不受限:前者是调用方明确要求"现在就跑完",
    // 后者本来就带指数退避。
    //
    // 增量 reconcile 不受限 —— 贵的是全量遍历,不是它。一次自称增量、却需要整库重建的变更,
    // reconciler 会交还 REBUILD_REQUIRED(而不是就地跑完),下面把它重排成全量,于是它也走这道闸。
    if (full && !force && !retryFullReconcile) {
      const remainingMs = fullReconcileCooldownRemainingMs();
      if (remainingMs > 0) {
        if (!cooldownTimer) {
          cooldownTimer = setTimeout(() => {
            cooldownTimer = undefined;
            flush();
          }, remainingMs);
          cooldownTimer.unref?.();
        }
        return; // 待办不清空:fullReconcile / pendingPaths 原样留到冷却结束。
      }
    }
    clearCooldownTimer();
    const startedAt = Date.now();
    pendingPaths.clear();
    pendingRenamePaths.clear();
    fullReconcile = false;
    reconcileRunning = true;
    const reconcileChange = renamePaths.length > 0 ? { full, paths, renamePaths } : { full, paths };
    running = Promise.resolve()
      // `deferRebuild` 走第二个参数,不进 change —— 那个载荷的形状被
      // `onlyPreviewSearchEngineWatchBoundary` 逐字钉着,多一个键就是改契约。
      // 只在增量派发上打开:这批若需要整库重建,reconciler 交还 REBUILD_REQUIRED,
      // 这里重排成全量,于是它也走上和全量同一道退避闸。
      .then(() => onReconcile(reconcileChange, { deferRebuild: !full }))
      .then(
        (result) => {
          // 一次增量变更被判定需要整库重建 —— reconciler 没有就地跑,交还给这里重排成全量,
          // 这样它和真正的全量共用同一道退避闸,而真增量依旧不受任何延迟。
          if (result === REBUILD_REQUIRED) fullReconcile = true;
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
        if (full) {
          lastFullReconcileEndedAt = Date.now();
          lastFullReconcileMs = Math.max(0, lastFullReconcileEndedAt - startedAt);
        }
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
    probeConfig();
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
        if (filename === null || filename === undefined) {
          probeConfig();
          fullReconcile = true;
          browseFull = true;
        } else {
          const relativePath = String(filename).replaceAll('\\', '/');
          if (isWorkspaceConfigWatchPath(relativePath)) {
            onConfigChange?.();
            return;
          }
          pendingPaths.add(relativePath);
          if (!browseFull) {
            pendingBrowsePaths.add(relativePath);
            if (pendingBrowsePaths.size > MAX_WATCH_CHANGE_PATHS) {
              pendingBrowsePaths.clear();
              browseFull = true;
            }
          }
          if (eventType === 'rename') pendingRenamePaths.add(relativePath);
        }
        schedule();
        scheduleBrowse();
      });
      if (!attachedWatcher || typeof attachedWatcher.on !== 'function') {
        throw new TypeError('Recursive watch did not return an event source');
      }
      watcher = attachedWatcher;
      attachedWatcher.on('error', (error) => markWatcherUnavailable(error, attachedWatcher));
      watcherRetryAttempt = 0;
      clearWatcherRetryTimer();
      clearFallbackTimer();
      clearTimeout(browseTimer);
      pendingBrowsePaths.clear();
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
      probeConfig();
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
      clearCooldownTimer();
      const activeWatcher = watcher;
      watcher = undefined;
      activeWatcher?.close?.();
      if (drain) await Promise.all([running, browseRunning]);
      retryFullReconcile = false;
      fallbackEligible = false;
      recoveryReconcileNeeded = false;
    },
    mode() {
      return watcher ? 'watch' : 'fallback-reconcile';
    }
  };
};

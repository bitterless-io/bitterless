const SCOPE = '[onlypreview-search]';
const MAX_COUNT = 1_000_000_000;
const MAX_ELAPSED_MS = 86_400_000;

const schemas = Object.freeze({
  'runtime-window': { tag: 'tag', phase: ['start', 'renderer-loaded', 'preload-ready', 'relay-attached'], elapsedMs: 'elapsed' },
  'runtime-window-terminal': { tag: 'tag', outcome: ['success', 'failure'], elapsedMs: 'elapsed' },
  'visible-window': { tag: 'tag', phase: ['start', 'runtime-ready', 'renderer-loaded'], elapsedMs: 'elapsed' },
  'visible-window-terminal': { tag: 'tag', outcome: ['success', 'failure'], elapsedMs: 'elapsed' },
  'initialize-start': { tag: 'tag', generation: 'count' },
  'initialize-terminal': { tag: 'tag', outcome: ['success', 'failure', 'cancelled'], elapsedMs: 'elapsed' },
  'initialize-failure': { tag: 'tag', phase: ['shutdown', 'authority', 'config', 'sqlite-open', 'tree-restore', 'quarantine', 'watch-start', 'root-listing', 'snapshot', 'count', 'rebuild'], sqliteCode: 'count' },
  'sqlite-recovery': { tag: 'tag', sqliteCode: 'count', retained: 'boolean' },
  'sqlite-close-failure': { tag: 'tag', sqliteCode: 'count' },
  // Sizes are MiB, not bytes: `count` is bounded to 1e9, which a 6 GB index silently saturates.
  'candidate-plan': { tag: 'tag', mode: ['reconcile', 'fresh', 'none'], indexMiB: 'count', freeMiB: 'count', requiredMiB: 'count' },
  'candidate-reclaim': { tag: 'tag', reclaimedMiB: 'count', freeMiB: 'count' },
  'sqlite-open': { tag: 'tag', reusable: 'boolean', reconcile: 'boolean', elapsedMs: 'elapsed' },
  'root-listing': { tag: 'tag', count: 'count', elapsedMs: 'elapsed' },
  'full-count': { tag: 'tag', count: 'count', elapsedMs: 'elapsed' },
  // `clone` / `copy` 是 2026-09-22 加的:候选镜像从 SQLite `backup()` 换成了文件级克隆
  // (APFS clonefile,实测 2.7 GB 从 26,568 ms 降到 95 ms),退化时走普通拷贝。两者耗时差两个
  // 数量级,现场必须能区分。`backup` 保留,老日志里还有它。
  //
  // 枚举漏一个值不会报错 —— 下面 `kind.includes(value)` 不匹配就**静默丢掉那个字段**,日志变成
  // 一行没有 mode 的记录。所以加了新取值必须同时加到这里。
  'candidate-backup': { tag: 'tag', mode: ['backup', 'clone', 'copy', 'fresh'], elapsedMs: 'elapsed' },
  'traversal-index': { tag: 'tag', mode: ['reconcile', 'rebuild'], count: 'count', elapsedMs: 'elapsed' },
  'promotion-wait': { tag: 'tag', elapsedMs: 'elapsed' },
  'promotion-commit': { tag: 'tag', buildRevision: 'count', elapsedMs: 'elapsed' },
  'search-accepted': { tag: 'tag', generation: 'count' },
  'search-gate': { tag: 'tag', gate: ['priority', 'promotion', 'metadata', 'index-build'], elapsedMs: 'elapsed' },
  'search-first-section': { tag: 'tag', section: ['files', 'contents'], elapsedMs: 'elapsed' },
  'search-section-terminal': { tag: 'tag', section: ['files', 'contents'], count: 'count', truncated: 'boolean', elapsedMs: 'elapsed' },
  'search-terminal': { tag: 'tag', outcome: ['success', 'failure', 'cancelled'], filesCount: 'count', contentsCount: 'count', elapsedMs: 'elapsed' },
  'xpc-start': { tag: 'tag', method: ['initialize', 'search'] },
  'xpc-terminal': { tag: 'tag', method: ['initialize', 'search'], outcome: ['success', 'failure'], elapsedMs: 'elapsed' },
  'runtime-accepted': { tag: 'tag', method: ['initialize', 'search'], generation: 'count' },
  'runtime-terminal': { tag: 'tag', method: ['initialize', 'search'], outcome: ['success', 'failure'], elapsedMs: 'elapsed' },
  'runtime-coalesced': { tag: 'tag', method: ['initialize', 'search'], generation: 'count' },
  'shell-dispatch': { tag: 'tag', generation: 'count' },
  'restore-index-grace': { tag: 'tag', phase: ['scheduled', 'start', 'resumed', 'cancel', 'superseded', 'schedule-failure', 'action-failure'], generation: 'count', elapsedMs: 'elapsed' },
  'shell-initialized': { tag: 'tag', outcome: ['success', 'failure'], elapsedMs: 'elapsed' },
  'shell-first-batch': { tag: 'tag', section: ['files', 'contents'], count: 'count', elapsedMs: 'elapsed' },
  'shell-terminal': { tag: 'tag', outcome: ['success', 'failure', 'cancelled'], filesCount: 'count', contentsCount: 'count', elapsedMs: 'elapsed' }
});

const boundedInteger = (value, maximum) =>
  Math.min(maximum, Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0));

const safeNow = (clock) => {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

export const createOnlyPreviewSearchDiagnostics = ({
  clock = () => globalThis.performance?.now?.() ?? 0,
  write = (line) => console.info(line)
} = {}) => {
  let sequence = 0;
  const now = () => safeNow(clock);
  const elapsed = (startedAt) => boundedInteger(now() - startedAt, MAX_ELAPSED_MS);
  const nextTag = (prefix = 'd') => {
    sequence += 1;
    const safePrefix = /^[a-z]$/.test(prefix) ? prefix : 'd';
    return `${safePrefix}${sequence.toString(36)}`.slice(0, 12);
  };
  const emit = (event, fields = {}) => {
    try {
      const schema = schemas[event];
      if (!schema) return false;
      const parts = [`${SCOPE} event=${event}`];
      for (const [key, kind] of Object.entries(schema)) {
        const value = fields[key];
        if (kind === 'tag') {
          if (/^[a-z][a-z0-9]{0,11}$/.test(value)) parts.push(`${key}=${value}`);
        } else if (kind === 'boolean') {
          if (typeof value === 'boolean') parts.push(`${key}=${value}`);
        } else if (kind === 'count') {
          parts.push(`${key}=${boundedInteger(value, MAX_COUNT)}`);
        } else if (kind === 'elapsed') {
          parts.push(`${key}=${boundedInteger(value, MAX_ELAPSED_MS)}`);
        } else if (kind.includes(value)) {
          parts.push(`${key}=${value}`);
        }
      }
      write(parts.join(' '));
      return true;
    } catch {
      return false;
    }
  };
  return Object.freeze({ emit, elapsed, nextTag, now });
};

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
  'sqlite-open': { tag: 'tag', reusable: 'boolean', reconcile: 'boolean', elapsedMs: 'elapsed' },
  'root-listing': { tag: 'tag', count: 'count', elapsedMs: 'elapsed' },
  'full-count': { tag: 'tag', count: 'count', elapsedMs: 'elapsed' },
  'candidate-backup': { tag: 'tag', mode: ['backup', 'fresh'], elapsedMs: 'elapsed' },
  'traversal-index': { tag: 'tag', mode: ['reconcile', 'rebuild'], count: 'count', elapsedMs: 'elapsed' },
  'promotion-wait': { tag: 'tag', elapsedMs: 'elapsed' },
  'promotion-commit': { tag: 'tag', buildRevision: 'count', elapsedMs: 'elapsed' },
  'search-accepted': { tag: 'tag', generation: 'count' },
  'search-gate': { tag: 'tag', gate: ['priority', 'promotion', 'initial-tree'], elapsedMs: 'elapsed' },
  'search-first-section': { tag: 'tag', section: ['files', 'contents'], elapsedMs: 'elapsed' },
  'search-section-terminal': { tag: 'tag', section: ['files', 'contents'], count: 'count', truncated: 'boolean', elapsedMs: 'elapsed' },
  'search-terminal': { tag: 'tag', outcome: ['success', 'failure', 'cancelled'], filesCount: 'count', contentsCount: 'count', elapsedMs: 'elapsed' },
  'xpc-start': { tag: 'tag', method: ['initialize', 'search'] },
  'xpc-terminal': { tag: 'tag', method: ['initialize', 'search'], outcome: ['success', 'failure'], elapsedMs: 'elapsed' },
  'runtime-accepted': { tag: 'tag', method: ['initialize', 'search'], generation: 'count' },
  'runtime-terminal': { tag: 'tag', method: ['initialize', 'search'], outcome: ['success', 'failure'], elapsedMs: 'elapsed' },
  'shell-dispatch': { tag: 'tag', generation: 'count' },
  'restore-index-grace': { tag: 'tag', phase: ['scheduled', 'start', 'cancel'], generation: 'count', elapsedMs: 'elapsed' },
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

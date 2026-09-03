const SCOPE = '[omni-open]';
const MAX_COUNT = 1_000_000;
const MAX_ELAPSED_MS = 86_400_000;
const MAX_RECEIPT_EVENTS = 1_024;

const schemas = Object.freeze({
  'open-start': {
    tag: 'tag',
    route: ['api'],
    mode: ['cold', 'existing'],
    generation: 'count',
  },
  'open-stage': {
    tag: 'tag',
    phase: ['native', 'restore', 'first-visible', 'interactive', 'ready'],
    totalCount: 'count',
    browserCount: 'count',
    miniAppCount: 'count',
    visible: 'boolean',
    focused: 'boolean',
    elapsedMs: 'elapsed',
    stageMs: 'elapsed',
  },
  'open-terminal': {
    tag: 'tag',
    outcome: ['success', 'failure', 'timeout', 'superseded'],
    reason: [
      'none',
      'create-fail',
      'load-fail',
      'unresponsive',
      'process-gone',
      'renderer-fail',
      'closed',
      'invalidated',
      'diagnostic-timeout',
    ],
    pendingTopLoad: 'count',
    pendingTopMount: 'count',
    pendingBrowserLoad: 'count',
    pendingBrowserMount: 'count',
    elapsedMs: 'elapsed',
  },
  'renderer-start': {
    tag: 'tag',
    parentTag: 'tag',
    role: ['top', 'browser', 'control'],
    generation: 'count',
  },
  'renderer-stage': {
    tag: 'tag',
    role: ['top', 'browser', 'control'],
    phase: [
      'create',
      'load-start',
      'dom-ready',
      'load-finish',
      'load-fail',
      'unresponsive',
      'responsive',
      'process-gone',
      'renderer-script',
      'renderer-language',
      'renderer-import',
      'renderer-mount',
      'layout-ready',
    ],
    outcome: ['success', 'failure'],
    backgroundThrottling: 'boolean',
    elapsedMs: 'elapsed',
    stageMs: 'elapsed',
  },
  'renderer-terminal': {
    tag: 'tag',
    role: ['top', 'browser', 'control'],
    outcome: ['ready', 'failure', 'timeout', 'superseded'],
    reason: [
      'none',
      'load-fail',
      'unresponsive',
      'process-gone',
      'renderer-fail',
      'invalidated',
      'diagnostic-timeout',
    ],
    elapsedMs: 'elapsed',
  },
  'navigation-start': {
    tag: 'tag',
    parentTag: 'tag',
    generation: 'count',
  },
  'navigation-stage': {
    tag: 'tag',
    phase: ['scheduled', 'start'],
    elapsedMs: 'elapsed',
    stageMs: 'elapsed',
  },
  'navigation-terminal': {
    tag: 'tag',
    outcome: ['success', 'failure', 'timeout', 'superseded'],
    elapsedMs: 'elapsed',
  },
  'renderer-receipt': {
    tag: 'tag',
    parentTag: 'tag',
    role: ['top', 'browser', 'control', 'unknown'],
    outcome: ['accepted', 'rejected'],
  },
});

const requiredEnumKeys = Object.freeze({
  'open-start': ['route', 'mode'],
  'open-stage': ['phase'],
  'open-terminal': ['outcome', 'reason'],
  'renderer-start': ['role'],
  'renderer-stage': ['role', 'phase', 'outcome'],
  'renderer-terminal': ['role', 'outcome', 'reason'],
  'navigation-stage': ['phase'],
  'navigation-terminal': ['outcome'],
  'renderer-receipt': ['role', 'outcome'],
});

const boundedInteger = (value, maximum) =>
  Math.min(maximum, Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0));

const readClock = (clock) => {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

export const createOmniOpenDiagnostics = ({
  clock = () => globalThis.performance?.now?.() ?? 0,
  write = (line) => console.info(line),
} = {}) => {
  let sequence = 0;
  let receiptCount = 0;
  let lastNow = 0;
  const now = () => {
    lastNow = Math.max(lastNow, readClock(clock));
    return lastNow;
  };
  const elapsed = (startedAt) => boundedInteger(now() - startedAt, MAX_ELAPSED_MS);
  const nextTag = (prefix = 'o') => {
    sequence += 1;
    const safePrefix = /^[a-z]$/.test(prefix) ? prefix : 'o';
    return `${safePrefix}${sequence.toString(36)}`.slice(0, 12);
  };
  const emit = (event, fields = {}) => {
    try {
      const schema = schemas[event];
      if (!schema) return false;
      for (const key of requiredEnumKeys[event] ?? []) {
        const allowlist = schema[key];
        if (!Array.isArray(allowlist) || !allowlist.includes(fields[key])) return false;
      }
      const parts = [`${SCOPE} event=${event}`];
      for (const [key, kind] of Object.entries(schema)) {
        const value = fields[key];
        if (kind === 'tag') {
          if (typeof value === 'string' && /^[a-z][a-z0-9]{0,11}$/.test(value)) {
            parts.push(`${key}=${value}`);
          }
        } else if (kind === 'boolean') {
          if (typeof value === 'boolean') parts.push(`${key}=${value}`);
        } else if (kind === 'count') {
          parts.push(`${key}=${boundedInteger(value, MAX_COUNT)}`);
        } else if (kind === 'elapsed') {
          parts.push(`${key}=${boundedInteger(value, MAX_ELAPSED_MS)}`);
        } else if (Array.isArray(kind) && kind.includes(value)) {
          parts.push(`${key}=${value}`);
        }
      }
      write(parts.join(' '));
      return true;
    } catch {
      return false;
    }
  };
  const trace = (flow, startFields = {}, prefix = flow[0]) => {
    const tag = nextTag(prefix);
    const startedAt = now();
    let stageAt = startedAt;
    let terminal = false;
    emit(`${flow}-start`, { tag, ...startFields });
    return Object.freeze({
      tag,
      mark(fields) {
        if (terminal) return false;
        const current = now();
        const result = emit(`${flow}-stage`, {
          tag,
          ...fields,
          elapsedMs: boundedInteger(current - startedAt, MAX_ELAPSED_MS),
          stageMs: boundedInteger(current - stageAt, MAX_ELAPSED_MS),
        });
        stageAt = current;
        return result;
      },
      end(fields) {
        if (terminal) return false;
        terminal = true;
        return emit(`${flow}-terminal`, { tag, ...fields, elapsedMs: elapsed(startedAt) });
      },
    });
  };
  const receipt = (fields) => {
    if (receiptCount >= MAX_RECEIPT_EVENTS) return false;
    const written = emit('renderer-receipt', { tag: nextTag('q'), ...fields });
    if (written) receiptCount += 1;
    return written;
  };
  return Object.freeze({ emit, elapsed, nextTag, now, receipt, trace });
};

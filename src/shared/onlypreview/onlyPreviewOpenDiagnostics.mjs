const SCOPE = '[onlypreview-open]';
const MAX_MS = 86_400_000;

const schemas = Object.freeze({
  'window-start': { tag: 'tag', route: ['api', 'explicit'], mode: ['existing', 'cold'] },
  'window-stage': { tag: 'tag', phase: ['native', 'runtime-search', 'runtime-office', 'runtime-authority', 'runtime-preview-read', 'runtime', 'shell-create', 'shell-load-start', 'shell-dom-ready', 'shell-did-finish', 'shell-load-resolved', 'renderer-script', 'renderer-language', 'renderer-import', 'renderer-mount', 'renderer-receipt', 'first-visible', 'interactive', 'show'], role: ['base', 'hidden-search', 'shell'], lifecycle: ['created', 'ready', 'loading', 'dom-ready', 'did-finish', 'load-resolved', 'bootstrap', 'shown', 'interactive'], visible: 'boolean', focused: 'boolean', backgroundThrottling: 'boolean', elapsedMs: 'elapsed', stageMs: 'elapsed' },
  'window-terminal': { tag: 'tag', outcome: ['success', 'failure', 'timeout', 'superseded'], reason: ['none', 'fail', 'closed', 'load-fail', 'render-gone', 'unresponsive', 'bootstrap-fail', 'superseded', 'diagnostic-timeout'], elapsedMs: 'elapsed' },
  'target-start': { tag: 'tag', kind: ['file', 'directory', 'unknown'] },
  'target-stage': { tag: 'tag', phase: ['fifo', 'window', 'inspect', 'authority', 'presentation-issued', 'accepted'], kind: ['file', 'directory', 'unknown'], authority: ['project', 'external', 'directory', 'unknown'], elapsedMs: 'elapsed', stageMs: 'elapsed' },
  'target-terminal': { tag: 'tag', outcome: ['accepted', 'failure', 'superseded'], elapsedMs: 'elapsed' },
  'preview-start': { tag: 'tag', parentTag: 'tag', revision: 'count', surface: ['vue', 'chrome', 'unknown'] },
  'preview-stage': { tag: 'tag', revision: 'count', phase: ['workspace', 'descriptor', 'published', 'renderer-reset'], surface: ['vue', 'chrome', 'office', 'unknown'], elapsedMs: 'elapsed', stageMs: 'elapsed' },
  'preview-terminal': { tag: 'tag', revision: 'count', surface: ['vue', 'chrome', 'office', 'unknown'], outcome: ['ready', 'error', 'superseded'], elapsedMs: 'elapsed' }
});

const bounded = (value) => Math.min(MAX_MS, Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0));
const count = (value) => Math.min(1_000_000_000, bounded(value));
const safeNow = (clock) => {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

export const createOnlyPreviewOpenDiagnostics = ({
  clock = () => globalThis.performance?.now?.() ?? 0,
  write = (line) => console.info(line)
} = {}) => {
  let sequence = 0;
  const now = () => safeNow(clock);
  const elapsed = (startedAt) => bounded(now() - startedAt);
  const nextTag = (prefix = 'o') => {
    sequence += 1;
    return `${/^[a-z]$/.test(prefix) ? prefix : 'o'}${sequence.toString(36)}`.slice(0, 12);
  };
  const emit = (event, fields = {}) => {
    try {
      const schema = schemas[event];
      if (!schema) return false;
      const parts = [`${SCOPE} event=${event}`];
      for (const [key, kind] of Object.entries(schema)) {
        const value = fields[key];
        if (kind === 'tag' && /^[a-z][a-z0-9]{0,11}$/.test(value)) parts.push(`${key}=${value}`);
        else if (kind === 'boolean' && typeof value === 'boolean') parts.push(`${key}=${value}`);
        else if (kind === 'elapsed') parts.push(`${key}=${bounded(value)}`);
        else if (kind === 'count') parts.push(`${key}=${count(value)}`);
        else if (Array.isArray(kind) && kind.includes(value)) parts.push(`${key}=${value}`);
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
          elapsedMs: bounded(current - startedAt),
          stageMs: bounded(current - stageAt)
        });
        stageAt = current;
        return result;
      },
      end(fields) {
        if (terminal) return false;
        terminal = true;
        return emit(`${flow}-terminal`, { tag, ...fields, elapsedMs: elapsed(startedAt) });
      }
    });
  };
  return Object.freeze({ emit, elapsed, nextTag, now, trace });
};

export const createOnlyPreviewWindowOpenCoordinator = ({
  diagnostics,
  timeoutMs = 300_000,
  setTimer = (run, delay) => setTimeout(run, delay),
  clearTimer = (timer) => clearTimeout(timer)
}) => {
  let active = null;
  const finish = (tag, outcome, reason = 'none') => {
    if (!active || active.trace.tag !== tag) return false;
    const current = active;
    active = null;
    clearTimer(current.timer);
    return current.trace.end({ outcome, reason });
  };
  const begin = (route, mode) => {
    if (active) finish(active.trace.tag, 'superseded', 'superseded');
    const trace = diagnostics.trace('window', { route, mode }, 'w');
    const timer = setTimer(() => finish(trace.tag, 'timeout', 'diagnostic-timeout'), timeoutMs);
    timer?.unref?.();
    active = { trace, timer };
    return trace;
  };
  return Object.freeze({
    begin,
    finish,
    isActive(tag) {
      return active?.trace.tag === tag;
    },
    mark(tag, fields) {
      return active?.trace.tag === tag ? active.trace.mark(fields) : false;
    },
    supersede() {
      return active ? finish(active.trace.tag, 'superseded', 'superseded') : false;
    }
  });
};

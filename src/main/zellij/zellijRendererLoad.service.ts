import type { WebContents } from 'electron';

export const ZELLIJ_RENDERER_LOAD_TIMEOUT_MS = 15_000;

/** Settle independently of Chromium, including when closing a view does not reject its navigation. */
export const loadZellijRenderer = (
  contents: WebContents,
  load: () => Promise<void>,
  kind: 'controls' | 'terminal',
  signal: AbortSignal,
  timeoutMs = ZELLIJ_RENDERER_LOAD_TIMEOUT_MS
): Promise<void> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      contents.removeListener('destroyed', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = (): void => finish(new Error('operation-failed'));
    const timer = setTimeout(() => finish(new Error(kind + '-load-timeout')), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    contents.once('destroyed', abort);
    if (signal.aborted || contents.isDestroyed()) {
      abort();
      return;
    }
    try {
      void load().then(
        () => finish(),
        () => finish(new Error(kind + '-load-failed'))
      );
    } catch {
      finish(new Error(kind + '-load-failed'));
    }
  });

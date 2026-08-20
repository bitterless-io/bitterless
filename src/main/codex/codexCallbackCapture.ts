import { createServer } from 'node:http';

const CODEX_CALLBACK_PORT = 1455;
const CODEX_CALLBACK_HOST = '::1';
// `server.close()` only calls back once every connection is gone. The browser tab that received
// the redirect keeps its socket open, so teardown is forced and deadline-bounded: a wedged listener
// must never hold back an already-promoted credential.
const CODEX_CALLBACK_CLOSE_TIMEOUT_MS = 2_000;

export interface CodexBrowserCallbackCapture {
  waitForRedirect(): Promise<string>;
  cancel(error: Error): void;
  close(): Promise<void>;
}

export interface CodexCallbackCaptureOptions {
  onUnavailable?: (message: string) => void;
  port?: number;
  closeTimeoutMs?: number;
}

export class CodexCallbackCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexCallbackCaptureError';
  }
}

export const createCodexBrowserCallbackCapture = async (
  options: CodexCallbackCaptureOptions = {}
): Promise<CodexBrowserCallbackCapture> => {
  let resolveRedirect: ((url: string) => void) | null = null;
  let rejectRedirect: ((error: Error) => void) | null = null;
  let settled = false;
  let listening = false;
  let closing: Promise<void> | null = null;
  const redirect = new Promise<string>((resolve, reject) => {
    resolveRedirect = resolve;
    rejectRedirect = reject;
  });
  redirect.catch(() => undefined);
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://localhost:1455');
    if (url.pathname !== '/auth/callback') {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<html><body>OpenAI sign-in complete. You can close this tab.</body></html>');
    if (!settled) {
      settled = true;
      resolveRedirect?.(`http://localhost:1455${request.url || ''}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (): void => {
      options.onUnavailable?.('bind-failed');
      reject(new CodexCallbackCaptureError('Codex IPv6 callback companion could not bind.'));
    };
    server.once('error', onError);
    server.listen(options.port ?? CODEX_CALLBACK_PORT, CODEX_CALLBACK_HOST, () => {
      server.removeListener('error', onError);
      server.on('error', () => {
        options.onUnavailable?.('listener-error');
        if (settled) return;
        settled = true;
        rejectRedirect?.(
          new CodexCallbackCaptureError('Codex IPv6 callback companion stopped unexpectedly.')
        );
      });
      listening = true;
      resolve();
    });
  });

  const close = async (): Promise<void> => {
    if (!listening) return await (closing ?? Promise.resolve());
    listening = false;
    closing = new Promise<void>((resolve) => {
      let closed = false;
      const finish = (): void => {
        if (closed) return;
        closed = true;
        resolve();
      };
      const deadline = setTimeout(() => {
        options.onUnavailable?.('close-timeout');
        finish();
      }, options.closeTimeoutMs ?? CODEX_CALLBACK_CLOSE_TIMEOUT_MS);
      (deadline as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
      server.close(() => {
        clearTimeout(deadline);
        finish();
      });
      // Without this, a browser tab still holding the callback socket keeps `close()` pending.
      server.closeAllConnections?.();
    });
    await closing;
  };

  return {
    waitForRedirect: async () => await redirect,
    cancel: (error) => {
      if (settled) return;
      settled = true;
      rejectRedirect?.(error);
    },
    close
  };
};

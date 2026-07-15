import { createServer, type Server } from 'node:http';

const CODEX_CALLBACK_PORT = 1455;
const CODEX_CALLBACK_HOST = '::1';

export interface CodexBrowserCallbackCapture {
  waitForRedirect(): Promise<string>;
  cancel(error: Error): void;
  close(): Promise<void>;
}

export interface CodexCallbackCaptureOptions {
  onUnavailable?: (message: string) => void;
}

const closeServer = async (server: Server, listening: boolean): Promise<void> => {
  if (!listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

export const createCodexBrowserCallbackCapture = async (
  options: CodexCallbackCaptureOptions = {},
): Promise<CodexBrowserCallbackCapture> => {
  let resolveRedirect: ((url: string) => void) | null = null;
  let rejectRedirect: ((error: Error) => void) | null = null;
  let settled = false;
  let listening = false;
  const redirect = new Promise<string>((resolve, reject) => {
    resolveRedirect = resolve;
    rejectRedirect = reject;
  });
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

  await new Promise<void>((resolve) => {
    const onError = (error: Error): void => {
      options.onUnavailable?.(error.message);
      resolve();
    };
    server.once('error', onError);
    server.listen(CODEX_CALLBACK_PORT, CODEX_CALLBACK_HOST, () => {
      server.removeListener('error', onError);
      server.on('error', (error) => options.onUnavailable?.(error.message));
      listening = true;
      resolve();
    });
  });

  return {
    waitForRedirect: async () => await redirect,
    cancel: (error) => {
      if (settled) return;
      settled = true;
      rejectRedirect?.(error);
    },
    close: async () => await closeServer(server, listening),
  };
};

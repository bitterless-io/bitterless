import { Socket } from 'node:net';
import { sanitizeDiagnostic } from '@shared/diagnostics/diagnostic.service';
import {
  decodeZellijServerMessage,
  encodeZellijClientMessage,
  ZellijNativeFrameDecoder
} from './zellijNativeProtocol';
import type {
  ZellijNativeClientMessage,
  ZellijNativeFirstClientOptions,
  ZellijNativeIpcErrorCode,
  ZellijNativeIpcOptions,
  ZellijNativeRequestOptions,
  ZellijNativeServerMessage
} from './zellijNativeIpc.type';

export class ZellijNativeIpcError extends Error {
  constructor(
    readonly code: ZellijNativeIpcErrorCode,
    message: string,
    /**
     * What Zellij itself said, sanitized and bounded — empty for every locally-decided failure
     * (timeout, abort, ENOENT).
     *
     * A rejection USED to collapse into the constant string 'Zellij rejected the request' while
     * `reply.logError.lines` — the server's own explanation — was dropped on the floor. That is
     * precisely the line the 2026-09-17 packaged incident left behind, and it is why the cause was
     * not recoverable afterwards (docs/issues/zellij-update-restart-blocks-and-new-tab-fails.md).
     * Callers put this in the log; it must never be shown to the user or used for control flow.
     */
    readonly detail: string = ''
  ) {
    // `message` stays byte-identical to what it always was, and the native text lives ONLY on
    // `detail`: tests/zellij/zellijNativeIpc.test.mjs:240 ("native rejections omit native payloads")
    // pins the error a consumer sees, and that boundary is right — a rejection reaches renderer
    // state and user-visible strings, a log line does not.
    super(message);
    this.name = 'ZellijNativeIpcError';
  }
}

/** Server error text, not pane content — still bounded and sanitized before it can reach a log. */
const rejectionDetail = (reply: ZellijNativeServerMessage): string => {
  if (reply.logError) return sanitizeDiagnostic(reply.logError.lines?.join(' | '), 160);
  if (!reply.exit) return '';
  const payload = sanitizeDiagnostic(reply.exit.payload, 120);
  return `exitReason=${reply.exit.exitReason}${payload ? ` payload=${payload}` : ''}`;
};

/** Exact Unix socket operations never enumerate or contact sibling Zellij sessions. */
export class ZellijNativeIpcService {
  private readonly timeoutMs: number;
  private readonly maxFrameBytes: number;

  constructor(
    private readonly socketPath: string,
    options: ZellijNativeIpcOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 750;
    this.maxFrameBytes = options.maxFrameBytes ?? 8 * 1024 * 1024;
  }

  async probe(options: ZellijNativeRequestOptions = {}): Promise<'ready' | 'absent'> {
    try {
      await this.request([{ connStatus: {} }], 'connected', options);
      return 'ready';
    } catch (error) {
      if (error instanceof ZellijNativeIpcError && error.code === 'absent') return 'absent';
      throw error;
    }
  }

  async listPanes(options: ZellijNativeRequestOptions = {}): Promise<string> {
    return this.query({ listPanes: { outputJson: true, showAll: true } }, options);
  }

  async currentTabInfo(options: ZellijNativeRequestOptions = {}): Promise<string> {
    return this.query({ currentTabInfo: { outputJson: true } }, options);
  }

  async killSession(options: ZellijNativeRequestOptions = {}): Promise<void> {
    await this.request([{ killSession: {} }], 'exit', options);
  }

  async firstClientConnected(
    cliAssets: ZellijNativeFirstClientOptions,
    options: ZellijNativeRequestOptions = {}
  ): Promise<void> {
    // Same connection preserves ordering: Connected acknowledges main-loop initialization.
    await this.request(
      [
        {
          firstClientConnected: {
            cliAssets: { terminalWindowSize: { cols: 50, rows: 50 }, ...cliAssets },
            isWebClient: false
          }
        },
        { connStatus: {} }
      ],
      'connected',
      { ...options, timeoutMs: options.timeoutMs ?? 5000 }
    );
  }

  private async query(
    action: NonNullable<ZellijNativeClientMessage['action']>['action'],
    options: ZellijNativeRequestOptions
  ): Promise<string> {
    const reply = await this.request([{ action: { action, isCliClient: true } }], 'log', options);
    return reply.log?.lines?.join('\n') ?? '';
  }

  private request(
    messages: ZellijNativeClientMessage[],
    expected: 'connected' | 'log' | 'exit',
    options: ZellijNativeRequestOptions
  ): Promise<ZellijNativeServerMessage> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new ZellijNativeIpcError('aborted', 'Zellij IPC request cancelled'));
        return;
      }
      const decoder = new ZellijNativeFrameDecoder(this.maxFrameBytes);
      const socket = new Socket();
      let finished = false;
      const finish = (error?: ZellijNativeIpcError, reply?: ZellijNativeServerMessage): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        socket.destroy();
        if (error) reject(error);
        else resolve(reply!);
      };
      const abort = (): void =>
        finish(new ZellijNativeIpcError('aborted', 'Zellij IPC request cancelled'));
      // A total deadline also bounds connecting and continuous partial/miscellaneous responses.
      const timer = setTimeout(
        () => finish(new ZellijNativeIpcError('timeout', 'Zellij IPC request timed out')),
        options.timeoutMs ?? this.timeoutMs
      );
      options.signal?.addEventListener('abort', abort, { once: true });
      socket.once('connect', () => {
        try {
          if (options.verifyEndpoint && !options.verifyEndpoint()) {
            finish(new ZellijNativeIpcError('unavailable', 'Zellij IPC endpoint changed'));
            return;
          }
          const frames = messages.map(encodeZellijClientMessage);
          if (frames.some((frame) => frame.length - 4 > this.maxFrameBytes)) {
            throw new Error('Zellij IPC request exceeds frame limit');
          }
          socket.write(Buffer.concat(frames));
        } catch {
          finish(new ZellijNativeIpcError('protocol-error', 'Invalid Zellij IPC request'));
        }
      });
      socket.on('data', (chunk: Buffer) => {
        if (finished) return;
        try {
          for (const body of decoder.push(chunk)) {
            const reply = decodeZellijServerMessage(body);
            if (reply.logError) {
              finish(
                new ZellijNativeIpcError(
                  'rejected',
                  'Zellij rejected the request',
                  rejectionDetail(reply)
                )
              );
              return;
            }
            if (reply.exit && (expected !== 'exit' || reply.exit.exitReason !== 1)) {
              finish(
                new ZellijNativeIpcError(
                  'rejected',
                  'Zellij rejected the request',
                  rejectionDetail(reply)
                )
              );
              return;
            }
            if (reply.message === expected) {
              finish(undefined, reply);
              return;
            }
          }
        } catch {
          finish(new ZellijNativeIpcError('protocol-error', 'Invalid Zellij IPC response'));
        }
      });
      socket.on('error', (error: NodeJS.ErrnoException) => {
        finish(
          new ZellijNativeIpcError(
            error.code === 'ENOENT' || error.code === 'ECONNREFUSED' ? 'absent' : 'unavailable',
            `Zellij IPC connection failed (${error.code ?? 'unknown'})`
          )
        );
      });
      const disconnected = (): void => {
        finish(
          new ZellijNativeIpcError(
            decoder.incomplete ? 'protocol-error' : 'disconnected',
            decoder.incomplete ? 'Truncated Zellij IPC response' : 'Zellij IPC connection closed'
          )
        );
      };
      socket.once('end', disconnected);
      socket.once('close', disconnected);
      try {
        socket.connect(this.socketPath);
      } catch {
        finish(new ZellijNativeIpcError('unavailable', 'Invalid Zellij IPC address'));
      }
    });
  }
}

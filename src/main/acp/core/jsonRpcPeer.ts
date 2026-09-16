import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import { AcpError } from './acpHost.type';

type RpcId = string | number;
type RpcHandler = (method: string, params: unknown, notification: boolean) => Promise<unknown>;
interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
}
export interface RpcOptions {
  maxMessageBytes?: number;
  maxQueuedBytes?: number;
  maxPendingRequests?: number;
  requestTimeoutMs?: number;
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is RpcId =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

/** Bounded full-duplex newline JSON-RPC. Handlers run concurrently so cancel/permissions cannot deadlock prompts. */
export class JsonRpcPeer {
  private buffer = Buffer.alloc(0);
  private pending = new Map<RpcId, PendingRequest>();
  private incoming = new Set<RpcId>();
  private queuedBytes = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private closed = false;
  private handler?: RpcHandler;
  private closeHandlers = new Set<() => void>();
  private readonly maxMessageBytes: number;
  private readonly maxQueuedBytes: number;
  private readonly maxPending: number;
  private readonly requestTimeout: number;

  constructor(private readable: Readable, private writable: Writable, options: RpcOptions = {}) {
    this.onData = this.onData.bind(this);
    this.onClosed = this.onClosed.bind(this);
    this.maxMessageBytes = options.maxMessageBytes ?? 4 * 1024 * 1024;
    this.maxQueuedBytes = options.maxQueuedBytes ?? 16 * 1024 * 1024;
    this.maxPending = options.maxPendingRequests ?? 128;
    this.requestTimeout = options.requestTimeoutMs ?? 120_000;
    readable.on('data', this.onData);
    readable.once('end', this.onClosed);
    readable.once('close', this.onClosed);
    readable.once('error', this.onClosed);
    writable.once('error', this.onClosed);
  }

  onMessage(handler: RpcHandler): void { this.handler = handler; }
  onClose(handler: () => void): void {
    if (this.closed) handler(); else this.closeHandlers.add(handler);
  }
  get isClosed(): boolean { return this.closed; }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  request<T = unknown>(method: string, params?: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    if (this.closed) return Promise.reject(new AcpError(-32603, 'Connection closed'));
    if (options.signal?.aborted) return Promise.reject(new AcpError(-32800, 'Request cancelled'));
    if (this.pending.size >= this.maxPending) return Promise.reject(new AcpError(-32600, 'Too many pending requests'));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const cancel = (): void => {
        this.pending.delete(id);
        cleanup();
        reject(new AcpError(-32800, 'Request cancelled'));
      };
      const timeout = options.timeoutMs ?? this.requestTimeout;
      const timer = timeout === 0 ? undefined : setTimeout(() => {
        this.pending.delete(id);
        cleanup();
        reject(new AcpError(-32603, 'Peer response timed out'));
      }, timeout);
      timer?.unref?.();
      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
      };
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, cleanup });
      options.signal?.addEventListener('abort', cancel, { once: true });
      void this.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }).catch((error: Error) => {
        this.pending.delete(id);
        cleanup();
        reject(error);
      });
    });
  }

  async close(): Promise<void> {
    this.onClosed();
    this.readable.destroy();
    if ((this.writable as unknown) !== this.readable) this.writable.destroy();
  }

  private onClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.readable.off('data', this.onData);
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(new AcpError(-32603, 'Connection closed'));
    }
    this.pending.clear();
    for (const handler of this.closeHandlers) handler();
    this.closeHandlers.clear();
  }

  private onData(data: Buffer | string): void {
    if (this.closed) return;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) >= 0) {
      if (newline > this.maxMessageBytes) { void this.close(); return; }
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (line.length === 0) continue;
      let message: unknown;
      try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
      catch { void this.error(null, new AcpError(-32700, 'Invalid JSON')).catch(() => undefined); continue; }
      void this.receive(message).catch(() => this.close());
    }
    if (this.buffer.length > this.maxMessageBytes) void this.close();
  }

  private async receive(message: unknown): Promise<void> {
    if (!isRecord(message) || message.jsonrpc !== '2.0') {
      await this.error(isRecord(message) && isId(message.id) ? message.id : null, new AcpError(-32600, 'Invalid JSON-RPC request'));
      return;
    }
    if (typeof message.method !== 'string') {
      if (isId(message.id) && ('result' in message || 'error' in message)) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        pending.cleanup();
        if ('error' in message) {
          const error = message.error;
          pending.reject(isRecord(error) && typeof error.code === 'number' && typeof error.message === 'string'
            ? new AcpError(error.code, error.message, error.data) : new AcpError(-32600, 'Invalid peer error'));
        } else pending.resolve(message.result);
      } else await this.error(isId(message.id) ? message.id : null, new AcpError(-32600, 'Invalid JSON-RPC request'));
      return;
    }
    const notification = !Object.prototype.hasOwnProperty.call(message, 'id');
    if (!notification && !isId(message.id)) { await this.error(null, new AcpError(-32600, 'Invalid request ID')); return; }
    if ('result' in message || 'error' in message || (message.params !== undefined && !isRecord(message.params))) {
      if (!notification) await this.error(message.id as RpcId, new AcpError(-32600, 'Invalid request envelope'));
      return;
    }
    const id = message.id as RpcId;
    if (!notification && (this.incoming.has(id) || this.incoming.size >= this.maxPending)) {
      await this.error(id, new AcpError(-32600, 'Duplicate ID or too many active requests'));
      return;
    }
    if (!notification) this.incoming.add(id);
    try {
      if (!this.handler) throw new AcpError(-32601, 'Method not found');
      const result = await this.handler(message.method, message.params ?? {}, notification);
      if (!notification) await this.send({ jsonrpc: '2.0', id, result: result ?? {} });
    } catch (error) {
      if (!notification) await this.error(id, error);
    } finally { if (!notification) this.incoming.delete(id); }
  }

  private async error(id: RpcId | null, error: unknown): Promise<void> {
    const resolved = error instanceof AcpError ? error : new AcpError(-32603, error instanceof Error ? error.message : 'Internal error');
    await this.send({ jsonrpc: '2.0', id, error: { code: resolved.code, message: resolved.message, ...(resolved.data === undefined ? {} : { data: resolved.data }) } });
  }

  private send(message: unknown): Promise<void> {
    if (this.closed) return Promise.reject(new AcpError(-32603, 'Connection closed'));
    const line = Buffer.from(`${JSON.stringify(message)}\n`);
    if (line.length > this.maxMessageBytes || this.queuedBytes + line.length > this.maxQueuedBytes) {
      void this.close();
      return Promise.reject(new AcpError(-32603, 'Transport output limit exceeded'));
    }
    this.queuedBytes += line.length;
    const operation = this.writeQueue.then(() => new Promise<void>((resolve, reject) => {
      if (this.closed) { reject(new AcpError(-32603, 'Connection closed')); return; }
      this.writable.write(line, (error) => error ? reject(error) : resolve());
    })).finally(() => { this.queuedBytes -= line.length; });
    this.writeQueue = operation.catch(() => { void this.close(); });
    return operation;
  }
}

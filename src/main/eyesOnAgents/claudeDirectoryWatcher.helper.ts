import { watch, type FSWatcher } from 'node:fs';
import net from 'node:net';
import {
  CLAUDE_INVENTORY_MAX_FRAME_BYTES,
  parseClaudeInventoryWatcherArgs
} from '@shared/eyesOnAgents/claudeInventoryBridge.contract';
import type {
  ClaudeInventoryInvalidation,
  ClaudeInventoryInvalidationSource
} from '@shared/eyesOnAgents/claudeInventoryBridge.type';

const COALESCE_MS = 200;
const RECONNECT_MS = 500;

export class ClaudeDirectoryWatcherHelper {
  private watchers: FSWatcher[] = [];
  private pending = new Set<ClaudeInventoryInvalidationSource>();
  private timer: NodeJS.Timeout | null = null;
  private flushPromise: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly args: ReturnType<typeof parseClaudeInventoryWatcherArgs>,
    private readonly now: () => number = Date.now,
    private readonly onFatal: (error: Error) => void = () => undefined
  ) {}

  start(): void {
    if (this.watchers.length > 0) return;
    try {
      for (const root of this.args.roots) {
        const watcher = watch(root.path, { recursive: true }, () => this.invalidate(root.source));
        watcher.on('error', (error) => this.fail(error));
        this.watchers.push(watcher);
      }
    } catch (error) {
      for (const watcher of this.watchers) watcher.close();
      this.watchers = [];
      throw error;
    }
  }

  private fail(error: Error): void {
    if (this.stopped) return;
    this.stop();
    this.onFatal(error);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  private invalidate(source: ClaudeInventoryInvalidationSource): void {
    if (this.stopped) return;
    this.pending.add(source);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, COALESCE_MS);
  }

  private async flush(): Promise<void> {
    if (this.flushPromise) return await this.flushPromise;
    const operation = (async (): Promise<void> => {
      while (this.pending.size > 0 && !this.stopped) {
        const sources = [...this.pending];
        this.pending.clear();
        for (const source of sources) {
          const frame: ClaudeInventoryInvalidation = {
            schemaVersion: 1,
            nonce: this.args.nonce,
            source,
            observedAt: this.now()
          };
          const encoded = `${JSON.stringify(frame)}\n`;
          if (Buffer.byteLength(encoded) > CLAUDE_INVENTORY_MAX_FRAME_BYTES) continue;
          let delivered = false;
          while (!delivered && !this.stopped) {
            delivered = await this.send(encoded);
            if (!delivered) await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
          }
        }
      }
    })();
    this.flushPromise = operation;
    try {
      await operation;
    } finally {
      if (this.flushPromise === operation) this.flushPromise = null;
      if (this.pending.size > 0 && !this.stopped) void this.flush();
    }
  }

  private async send(frame: string): Promise<boolean> {
    return await new Promise((resolve) => {
      const socket = net.createConnection(this.args.endpoint.path);
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(1_000, () => finish(false));
      socket.once('error', () => finish(false));
      socket.once('connect', () => socket.end(frame));
      socket.once('close', (hadError) => finish(!hadError));
    });
  }
}

export const runClaudeDirectoryWatcher = (
  argv: readonly string[],
  onFatal: (error: Error) => void = () => undefined
): ClaudeDirectoryWatcherHelper => {
  const helper = new ClaudeDirectoryWatcherHelper(
    parseClaudeInventoryWatcherArgs(argv),
    Date.now,
    onFatal
  );
  helper.start();
  return helper;
};

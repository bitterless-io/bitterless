import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ClaudeObservationRoots } from './claudePath.resolver';
import { ClaudeInventoryBridgeServer } from './claudeInventoryBridge.server';
import {
  CLAUDE_INVENTORY_NONCE_ARG,
  CLAUDE_INVENTORY_ROOT_ARG,
  CLAUDE_INVENTORY_SOCKET_ARG,
  CLAUDE_INVENTORY_WATCHER_ARG,
  getClaudeInventoryBridgeEndpoint,
  parseClaudeInventoryWatcherReady
} from '@shared/eyesOnAgents/claudeInventoryBridge.contract';

const READY_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 1_000;

export class ClaudeWatcherSupervisor {
  private readonly server = new ClaudeInventoryBridgeServer();
  private child: ChildProcess | null = null;
  private readyChild: ChildProcess | null = null;
  private startPromise: Promise<void> | null = null;
  private terminationCleanup: Promise<void> | null = null;
  private stopping = false;
  private desiredRunning = false;
  private intent = 0;
  private roots: ClaudeObservationRoots;

  constructor(private readonly dependencies: {
    userDataPath: string;
    execPath: string;
    helperEntryPath: string;
    roots: ClaudeObservationRoots;
    onInvalidation: () => void | Promise<void>;
    onTerminated?: (error: Error) => void | Promise<void>;
  }) { this.roots = dependencies.roots; }

  isRunning(): boolean {
    return this.child !== null && this.readyChild === this.child && this.server.isListening();
  }

  async updateRoots(roots: ClaudeObservationRoots): Promise<void> {
    const before = JSON.stringify(this.roots);
    const after = JSON.stringify(roots);
    if (before === after) return;
    this.roots = roots;
    this.intent += 1;
    if (!this.desiredRunning) return;
    await this.stopProcess();
    if (this.desiredRunning) await this.start();
  }

  async start(): Promise<void> {
    this.desiredRunning = true;
    if (this.startPromise) {
      await this.startPromise;
      if (this.desiredRunning && !this.isRunning() && this.startPromise === null) {
        await this.start();
      }
      return;
    }
    if (this.isRunning()) return;
    const intent = this.intent;
    const operation = this.performStart(intent);
    this.startPromise = operation;
    try {
      await operation;
    } finally {
      if (this.startPromise === operation) this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    this.desiredRunning = false;
    this.intent += 1;
    await this.stopProcess();
  }

  private async stopProcess(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.readyChild = null;
    if (child) await this.terminateChild(child);
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    await this.awaitTerminationCleanup();
    await this.server.stop();
  }

  private async performStart(intent: number): Promise<void> {
    await this.awaitTerminationCleanup();
    if (!this.desiredRunning || intent !== this.intent) return;
    this.stopping = false;
    const roots = [
      ...this.roots.desktopRoots.map((path) => ({ source: 'desktop' as const, path })),
      ...(this.roots.projectsRoot
        ? [{ source: 'transcripts' as const, path: this.roots.projectsRoot }]
        : [])
    ];
    if (roots.length === 0) return;
    if (!existsSync(this.dependencies.helperEntryPath)) {
      throw new Error('Claude directory watcher helper is unavailable');
    }
    const endpoint = getClaudeInventoryBridgeEndpoint(this.dependencies.userDataPath);
    const nonce = randomBytes(16).toString('hex');
    await this.server.start({
      endpoint,
      nonce,
      consume: () => this.dependencies.onInvalidation()
    });
    if (!this.desiredRunning || intent !== this.intent) {
      await this.server.stop();
      return;
    }
    const args = [
      this.dependencies.helperEntryPath,
      CLAUDE_INVENTORY_WATCHER_ARG,
      CLAUDE_INVENTORY_SOCKET_ARG,
      endpoint.path,
      CLAUDE_INVENTORY_NONCE_ARG,
      nonce,
      ...roots.flatMap((root) => [CLAUDE_INVENTORY_ROOT_ARG, `${root.source}=${root.path}`])
    ];
    const child = spawn(this.dependencies.execPath, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    this.child = child;
    this.readyChild = null;
    this.bindTermination(child);
    try {
      await this.waitUntilReady(child);
      if (this.child !== child || !this.desiredRunning || intent !== this.intent) {
        await this.discardStart(child);
        return;
      }
      this.readyChild = child;
    } catch (error) {
      await this.discardStart(child);
      throw error;
    }
  }

  private bindTermination(child: ChildProcess): void {
    let finalized = false;
    const finalize = (error?: Error): void => {
      if (finalized || this.child !== child) return;
      finalized = true;
      this.child = null;
      this.readyChild = null;
      if (this.stopping || !this.desiredRunning) return;
      let cleanupError: Error | null = null;
      const cleanup = this.server.stop().catch((failure: unknown) => {
        cleanupError = failure instanceof Error ? failure : new Error(String(failure));
      });
      this.terminationCleanup = cleanup;
      void cleanup.then(() => {
        if (this.terminationCleanup === cleanup) this.terminationCleanup = null;
        if (!this.desiredRunning || this.stopping) return;
        void this.dependencies.onTerminated?.(
          cleanupError ?? error ?? new Error('Claude directory watcher stopped unexpectedly')
        );
      });
    };
    child.once('error', (error) => finalize(error));
    child.once('exit', (code, signal) => finalize(new Error(
      `Claude directory watcher exited (${code ?? signal ?? 'unknown'})`
    )));
  }

  private async waitUntilReady(child: ChildProcess): Promise<void> {
    await new Promise<void>((resolveReady, rejectReady) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.off('message', onMessage);
        child.off('error', onError);
        child.off('exit', onExit);
        if (error) rejectReady(error);
        else resolveReady();
      };
      const onMessage = (value: unknown): void => {
        if (this.child !== child) return;
        try {
          parseClaudeInventoryWatcherReady(value);
          finish();
        } catch {
          // Only the exact content-free ready frame can admit the watcher.
        }
      };
      const onError = (error: Error): void => finish(error);
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => finish(new Error(
        `Claude directory watcher exited before ready (${code ?? signal ?? 'unknown'})`
      ));
      const timeout = setTimeout(() => finish(new Error(
        'Claude directory watcher did not become ready in time'
      )), READY_TIMEOUT_MS);
      child.on('message', onMessage);
      child.once('error', onError);
      child.once('exit', onExit);
    });
  }

  private async discardStart(child: ChildProcess): Promise<void> {
    if (this.child === child) {
      this.child = null;
      this.readyChild = null;
      await this.terminateChild(child);
    }
    await this.awaitTerminationCleanup();
    await this.server.stop();
  }

  private async terminateChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
    child.kill();
    const stopped = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), STOP_TIMEOUT_MS))
    ]);
    if (stopped || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGKILL');
    await Promise.race([
      exited,
      new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, STOP_TIMEOUT_MS))
    ]);
  }

  private async awaitTerminationCleanup(): Promise<void> {
    const cleanup = this.terminationCleanup;
    if (cleanup) await cleanup;
  }
}

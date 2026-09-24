import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import {
  HOME_SHELL_AUTH_SNAPSHOT_CHANGED_EVENT,
  HOME_SHELL_INITIAL_AUTH_PROBE,
  HOME_SHELL_SESSION_VALIDATION_TIMEOUT_MS,
  isHomeShellAuthSnapshotNewer,
  parseHomeShellAuthSnapshot,
  parseHomeShellAuthCommandResult,
  type HomeShellAuthSnapshot,
  type HomeShellBridgeApi
} from '@shared/home/homeShellBridge.contract';

/** Nonvisual capability authority. It never owns a window, view, or browser input. */
export class ApplicationAuthService {
  private snapshot: HomeShellAuthSnapshot | null = null;
  private pending: Promise<void> | null = null;
  private queued = false;
  private readGeneration = 0;
  private awaitingSignedOut = false;
  private validation: { generation: number; promise: Promise<void> } | null = null;
  private listeners = new Set<(ready: boolean) => void>();
  private readonly authority = createXpcMainEmitter<HomeShellBridgeApi>('HomeShellBridgeHandler');
  ready = false;
  generation = 0;

  constructor() {
    // Broadcast contents have no sender identity: they only trigger an addressed read.
    xpcMain.subscribe(HOME_SHELL_AUTH_SNAPSHOT_CHANGED_EVENT, () => void this.refresh());
  }

  subscribe(listener: (ready: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  invalidate(): void {
    this.readGeneration += 1;
    this.pending = null;
    this.queued = false;
    this.awaitingSignedOut = this.snapshot?.phase === 'ready';
    this.setReady(false, true);
  }

  assertReady(): void {
    if (!this.ready) throw new Error('[application auth] Sign in to Bitterless to use chat.');
  }

  async requireReady(): Promise<number> {
    const startingGeneration = this.generation;
    const wasReady = this.ready;
    await this.refresh();
    this.assertReady();
    if (wasReady) this.assertGeneration(startingGeneration);
    const generation = this.generation;
    if (this.validation?.generation !== generation) {
      const promise = this.validate(generation).finally(() => {
        if (this.validation?.promise === promise) this.validation = null;
      });
      this.validation = { generation, promise };
    }
    await this.validation.promise;
    this.assertGeneration(generation);
    return generation;
  }

  assertGeneration(generation: number): void {
    this.assertReady();
    if (generation !== this.generation) throw new Error('[application auth] Session changed.');
  }

  refresh(): Promise<void> {
    if (this.pending) {
      this.queued = true;
      return this.pending;
    }
    const generation = this.readGeneration;
    const request = this.read(generation).finally(() => {
      if (this.pending !== request) return;
      this.pending = null;
      if (this.queued) {
        this.queued = false;
        void this.refresh();
      }
    });
    this.pending = request;
    return request;
  }

  private setReady(ready: boolean, force = false): void {
    if (this.ready === ready && !force) return;
    this.ready = ready;
    this.generation += 1;
    for (const listener of this.listeners) listener(ready);
  }

  private applySnapshot(snapshot: HomeShellAuthSnapshot): void {
    const same =
      snapshot.authorityEpoch === this.snapshot?.authorityEpoch &&
      snapshot.revision === this.snapshot?.revision;
    if (!same && !isHomeShellAuthSnapshotNewer(snapshot, this.snapshot)) return;
    const ready = snapshot.phase === 'ready' && !snapshot.loggingOut;
    if (ready && this.awaitingSignedOut) return;
    const replaced =
      this.ready && ready &&
      (snapshot.authorityEpoch !== this.snapshot?.authorityEpoch ||
        snapshot.sessionId !== this.snapshot?.sessionId ||
        snapshot.email !== this.snapshot?.email);
    this.snapshot = snapshot;
    if (!ready) this.awaitingSignedOut = false;
    if (replaced) this.setReady(false, true);
    this.setReady(ready);
  }

  private async validate(generation: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = parseHomeShellAuthCommandResult(await Promise.race([
        this.authority.validateAuthSession(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('[application auth] Session validation timed out. Please retry.')),
            HOME_SHELL_SESSION_VALIDATION_TIMEOUT_MS);
        })
      ]));
      this.assertGeneration(generation);
      this.applySnapshot(result.snapshot);
      if (result.ok === false) throw new Error(`[application auth] ${result.error.message}`);
      this.assertGeneration(generation);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async read(generation: number): Promise<void> {
    for (let attempt = 0; attempt < HOME_SHELL_INITIAL_AUTH_PROBE.attempts; attempt += 1) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const snapshot = parseHomeShellAuthSnapshot(
          await Promise.race([
            this.authority.getAuthSnapshot(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error('Auth authority timeout')),
                HOME_SHELL_INITIAL_AUTH_PROBE.timeoutMs
              );
            })
          ])
        );
        if (generation !== this.readGeneration) return;
        this.applySnapshot(snapshot);
        return;
      } catch {
        if (generation !== this.readGeneration) return;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (attempt + 1 < HOME_SHELL_INITIAL_AUTH_PROBE.attempts) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, HOME_SHELL_INITIAL_AUTH_PROBE.retryDelayMs)
        );
      }
    }
    if (generation === this.readGeneration) this.setReady(false);
  }
}

export const applicationAuth = new ApplicationAuthService();

class ApplicationAuthHandler extends XpcMainHandler {
  async invalidate(): Promise<void> {
    applicationAuth.invalidate();
  }
  async refresh(): Promise<void> {
    await applicationAuth.refresh();
  }
}
new ApplicationAuthHandler();

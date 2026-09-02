export const OMNI_OPEN_READY_TIMEOUT_MS = 30_000;

export interface OmniOpenTimer {
  setTimeout(callback: () => void, timeoutMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface OmniOpenCoordinatorHooks<T> {
  getReady(): T | null;
  create(generation: number): Promise<T>;
  present(value: T, generation: number): void;
  cleanupIncomplete(generation: number, error: unknown): void;
  onInvalidate?(generation: number): void;
}

export interface OmniOpenCoordinatorOptions {
  timeoutMs?: number;
  timer?: OmniOpenTimer;
}

interface OmniOpenFlight<T> {
  generation: number;
  promise: Promise<T>;
}

export interface OmniGenerationReadyBatch {
  readonly generation: number;
  readonly promises: Promise<void>[];
}

export class OmniGenerationReadyCollector {
  private activeBatch: OmniGenerationReadyBatch | null = null;

  get active(): OmniGenerationReadyBatch | null {
    return this.activeBatch;
  }

  begin(generation: number): OmniGenerationReadyBatch {
    const batch: OmniGenerationReadyBatch = { generation, promises: [] };
    this.activeBatch = batch;
    return batch;
  }

  finish(batch: OmniGenerationReadyBatch): void {
    if (this.activeBatch === batch) this.activeBatch = null;
  }

  invalidate(): void {
    this.activeBatch = null;
  }
}

const defaultTimer: OmniOpenTimer = {
  setTimeout: (callback, timeoutMs) => globalThis.setTimeout(callback, timeoutMs),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

export class OmniOpenTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Omni window did not become ready within ${timeoutMs}ms`);
    this.name = 'OmniOpenTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class OmniOpenStaleGenerationError extends Error {
  readonly generation: number;

  constructor(generation: number) {
    super(`Omni open generation ${generation} is no longer current`);
    this.name = 'OmniOpenStaleGenerationError';
    this.generation = generation;
  }
}

export class OmniOpenCoordinator<T> {
  private readonly hooks: OmniOpenCoordinatorHooks<T>;
  private readonly timeoutMs: number;
  private readonly timer: OmniOpenTimer;
  private generation = 0;
  private flight: OmniOpenFlight<T> | null = null;

  constructor(
    hooks: OmniOpenCoordinatorHooks<T>,
    options: OmniOpenCoordinatorOptions = {},
  ) {
    const timeoutMs = options.timeoutMs ?? OMNI_OPEN_READY_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError('Omni open timeout must be a positive finite number');
    }
    this.hooks = hooks;
    this.timeoutMs = timeoutMs;
    this.timer = options.timer ?? defaultTimer;
  }

  open(): Promise<T> {
    const currentFlight = this.flight;
    if (currentFlight) return currentFlight.promise;

    const ready = this.hooks.getReady();
    if (ready !== null) {
      const generation = this.generation;
      return this.beginFlight(generation, () => this.presentReady(ready, generation));
    }

    const generation = this.generation + 1;
    this.generation = generation;
    return this.beginFlight(generation, () => this.createAndPresent(generation));
  }

  invalidate(): void {
    const invalidatedGeneration = this.generation;
    this.generation += 1;
    this.flight = null;
    this.hooks.onInvalidate?.(invalidatedGeneration);
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private beginFlight(
    generation: number,
    run: () => T | Promise<T>,
  ): Promise<T> {
    let resolveFlight!: (value: T | PromiseLike<T>) => void;
    let rejectFlight!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveFlight = resolve;
      rejectFlight = reject;
    });
    const flight: OmniOpenFlight<T> = { generation, promise };
    this.flight = flight;

    try {
      Promise.resolve(run()).then(resolveFlight, rejectFlight);
    } catch (error) {
      rejectFlight(error);
    }

    promise.then(
      () => this.clearFlight(flight),
      () => this.clearFlight(flight),
    );
    return promise;
  }

  private presentReady(ready: T, generation: number): T {
    try {
      this.hooks.present(ready, generation);
      return ready;
    } catch (error) {
      this.cleanupCurrent(generation, error);
      throw error;
    }
  }

  private async createAndPresent(generation: number): Promise<T> {
    let timeoutHandle: unknown;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = this.timer.setTimeout(() => {
        reject(new OmniOpenTimeoutError(this.timeoutMs));
      }, this.timeoutMs);
    });

    try {
      const created = await Promise.race([
        this.hooks.create(generation),
        timeout,
      ]);
      this.assertCurrent(generation);
      this.hooks.present(created, generation);
      this.assertCurrent(generation);
      return created;
    } catch (error) {
      this.cleanupCurrent(generation, error);
      throw error;
    } finally {
      if (timeoutHandle !== undefined) {
        this.timer.clearTimeout(timeoutHandle);
      }
    }
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) {
      throw new OmniOpenStaleGenerationError(generation);
    }
  }

  private cleanupCurrent(generation: number, error: unknown): void {
    if (!this.isCurrent(generation)) return;
    try {
      this.hooks.cleanupIncomplete(generation, error);
    } finally {
      if (this.isCurrent(generation)) {
        this.generation += 1;
      }
    }
  }

  private clearFlight(flight: OmniOpenFlight<T>): void {
    if (this.flight === flight) {
      this.flight = null;
    }
  }
}

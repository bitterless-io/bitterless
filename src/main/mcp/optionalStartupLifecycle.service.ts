export type OptionalStartupStageGuard = () => boolean;
export type StartupTimeoutScheduler = (
  onTimeout: () => void,
  timeoutMs: number,
) => () => void;

export interface StartupTimeoutOptions {
  label: string;
  timeoutMs: number;
  schedule?: StartupTimeoutScheduler;
}

export class StartupTimeoutError extends Error {
  readonly code = 'STARTUP_TIMEOUT';

  constructor(label: string, timeoutMs: number) {
    super(`${label} did not finish within ${timeoutMs}ms`);
    this.name = 'StartupTimeoutError';
  }
}

const scheduleStartupTimeout: StartupTimeoutScheduler = (onTimeout, timeoutMs) => {
  const timeout = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(timeout);
};

export const withStartupTimeout = <T>(
  operation: Promise<T>,
  options: StartupTimeoutOptions,
): Promise<T> => {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
      reject(new Error('Startup timeout must be a positive integer'));
      return;
    }

    let settled = false;
    const cancelTimeout = (options.schedule ?? scheduleStartupTimeout)(() => {
      if (settled) return;
      settled = true;
      reject(new StartupTimeoutError(options.label, options.timeoutMs));
    }, options.timeoutMs);

    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        cancelTimeout();
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        cancelTimeout();
        reject(err);
      },
    );
  });
};

export class OptionalStartupLifecycle {
  private startupPromise: Promise<void> | null = null;
  private isFenced = false;

  start(operation: (canStartNextStage: OptionalStartupStageGuard) => Promise<void>): Promise<void> {
    if (this.startupPromise) return this.startupPromise;
    if (this.isFenced) {
      this.startupPromise = Promise.resolve();
      return this.startupPromise;
    }
    this.startupPromise = Promise.resolve().then(async () => {
      await operation(() => !this.isFenced);
    });
    return this.startupPromise;
  }

  async fenceAndJoin(): Promise<void> {
    this.isFenced = true;
    await this.startupPromise;
  }
}

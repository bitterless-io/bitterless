export type UpdatePollingTimer = ReturnType<typeof setInterval>;

export interface UpdatePollingScheduler {
  setInterval(callback: () => void, intervalMs: number): UpdatePollingTimer;
  clearInterval(timer: UpdatePollingTimer): void;
}

export interface UpdatePollingOptions<TResult> {
  checkForUpdates: () => Promise<TResult>;
  intervalMs?: number;
  scheduler?: UpdatePollingScheduler;
  onCheckError?: (error: unknown) => void;
}

const defaultScheduler: UpdatePollingScheduler = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (timer) => clearInterval(timer)
};

export class UpdatePollingService<TResult> {
  private readonly performCheck: () => Promise<TResult>;
  private readonly intervalMs: number;
  private readonly scheduler: UpdatePollingScheduler;
  private readonly onCheckError: (error: unknown) => void;
  private pollingInterval: UpdatePollingTimer | null = null;
  private inFlightCheck: Promise<TResult> | null = null;

  constructor(options: UpdatePollingOptions<TResult>) {
    this.performCheck = options.checkForUpdates;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.onCheckError =
      options.onCheckError ??
      ((error) => {
        console.error('[UpdatePollingService] Update check failed:', error);
      });
  }

  startPolling(): boolean {
    if (this.pollingInterval !== null) return false;

    this.pollingInterval = this.scheduler.setInterval(() => {
      this.runScheduledCheck();
    }, this.intervalMs);
    this.runScheduledCheck();
    return true;
  }

  stopPolling(): boolean {
    if (this.pollingInterval === null) return false;

    this.scheduler.clearInterval(this.pollingInterval);
    this.pollingInterval = null;
    return true;
  }

  checkForUpdates(): Promise<TResult> {
    if (this.inFlightCheck) return this.inFlightCheck;

    let check: Promise<TResult>;
    try {
      check = this.performCheck();
    } catch (error) {
      check = Promise.reject(error);
    }

    const inFlightCheck = check.finally(() => {
      if (this.inFlightCheck === inFlightCheck) {
        this.inFlightCheck = null;
      }
    });
    this.inFlightCheck = inFlightCheck;
    return inFlightCheck;
  }

  private runScheduledCheck(): void {
    void this.checkForUpdates().catch((error) => {
      this.onCheckError(error);
    });
  }
}

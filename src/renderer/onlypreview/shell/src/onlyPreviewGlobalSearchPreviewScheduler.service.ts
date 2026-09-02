export const ONLY_PREVIEW_GLOBAL_SEARCH_PREVIEW_THROTTLE_MS = 120;

export interface OnlyPreviewGlobalSearchPreviewScheduler<T> {
  schedule(value: T): void;
  cancel(): void;
}

export interface OnlyPreviewGlobalSearchPreviewSchedulerClock {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const browserClock: OnlyPreviewGlobalSearchPreviewSchedulerClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer)
};

export const createOnlyPreviewGlobalSearchPreviewScheduler = <T>(
  run: (value: T) => void,
  thresholdMs = ONLY_PREVIEW_GLOBAL_SEARCH_PREVIEW_THROTTLE_MS,
  clock: OnlyPreviewGlobalSearchPreviewSchedulerClock = browserClock
): OnlyPreviewGlobalSearchPreviewScheduler<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let trailing: T | null = null;

  const armWindow = (): void => {
    timer = clock.setTimeout(() => {
      timer = null;
      const value = trailing;
      trailing = null;
      if (value === null) return;
      run(value);
      armWindow();
    }, thresholdMs);
  };

  return {
    schedule: (value) => {
      if (timer === null) {
        run(value);
        armWindow();
        return;
      }
      trailing = value;
    },
    cancel: () => {
      trailing = null;
      if (timer === null) return;
      clock.clearTimeout(timer);
      timer = null;
    }
  };
};

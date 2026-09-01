export const ONLY_PREVIEW_PROJECT_WIDTH_STORAGE_KEY = 'onlypreview.project-width.v1';
export const ONLY_PREVIEW_PROJECT_WIDTH_DEFAULT = 264;
export const ONLY_PREVIEW_PROJECT_WIDTH_MIN = 180;
export const ONLY_PREVIEW_PROJECT_WIDTH_MAX = 480;
export const ONLY_PREVIEW_PREVIEW_WIDTH_MIN = 320;
export const ONLY_PREVIEW_PROJECT_WIDTH_THROTTLE_MS = 200;

export interface OnlyPreviewProjectWidthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OnlyPreviewProjectWidthClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timer: unknown): void;
}

const browserClock: OnlyPreviewProjectWidthClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimer: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>)
};

const resolveBrowserStorage = (): OnlyPreviewProjectWidthStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const parseStoredWidth = (value: string | null): number | null => {
  if (value === null || !/^\d+$/.test(value)) return null;
  const width = Number(value);
  return Number.isFinite(width) &&
    Number.isInteger(width) &&
    width >= ONLY_PREVIEW_PROJECT_WIDTH_MIN &&
    width <= ONLY_PREVIEW_PROJECT_WIDTH_MAX
    ? width
    : null;
};

export const clampOnlyPreviewProjectWidth = (value: number, viewportWidth: number): number => {
  const width = Number.isFinite(value) ? Math.round(value) : ONLY_PREVIEW_PROJECT_WIDTH_DEFAULT;
  const viewportMaximum = Number.isFinite(viewportWidth)
    ? Math.floor(viewportWidth - ONLY_PREVIEW_PREVIEW_WIDTH_MIN)
    : ONLY_PREVIEW_PROJECT_WIDTH_MAX;
  const maximum = Math.max(
    ONLY_PREVIEW_PROJECT_WIDTH_MIN,
    Math.min(ONLY_PREVIEW_PROJECT_WIDTH_MAX, viewportMaximum)
  );
  return Math.min(maximum, Math.max(ONLY_PREVIEW_PROJECT_WIDTH_MIN, width));
};

export class OnlyPreviewProjectWidthPersistenceService {
  private pendingWidth: number | null = null;
  private lastWriteAt: number | null = null;
  private trailingTimer: unknown = null;

  constructor(
    private readonly storage: OnlyPreviewProjectWidthStorage | null,
    private readonly clock: OnlyPreviewProjectWidthClock = browserClock,
    private readonly throttleMs = ONLY_PREVIEW_PROJECT_WIDTH_THROTTLE_MS
  ) {}

  restore(viewportWidth: number): number {
    let storedWidth: number | null = null;
    try {
      storedWidth = parseStoredWidth(
        this.storage?.getItem(ONLY_PREVIEW_PROJECT_WIDTH_STORAGE_KEY) ?? null
      );
    } catch {
      // Renderer-local storage is optional; the default width remains usable without it.
    }
    return clampOnlyPreviewProjectWidth(
      storedWidth ?? ONLY_PREVIEW_PROJECT_WIDTH_DEFAULT,
      viewportWidth
    );
  }

  update(value: number, viewportWidth: number): number {
    const width = clampOnlyPreviewProjectWidth(value, viewportWidth);
    this.pendingWidth = width;
    const now = this.clock.now();
    const elapsed =
      this.lastWriteAt === null ? this.throttleMs : Math.max(0, now - this.lastWriteAt);
    if (elapsed >= this.throttleMs) {
      this.cancelTrailingTimer();
      this.commitPending();
      return width;
    }
    if (this.trailingTimer === null) {
      this.trailingTimer = this.clock.setTimer(() => {
        this.trailingTimer = null;
        this.commitPending();
      }, this.throttleMs - elapsed);
    }
    return width;
  }

  flush(): void {
    this.cancelTrailingTimer();
    this.commitPending();
  }

  private commitPending(): void {
    if (this.pendingWidth === null) return;
    const width = this.pendingWidth;
    this.pendingWidth = null;
    this.lastWriteAt = this.clock.now();
    try {
      this.storage?.setItem(ONLY_PREVIEW_PROJECT_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // A failed preference write must never interrupt live resizing or Shell teardown.
    }
  }

  private cancelTrailingTimer(): void {
    if (this.trailingTimer === null) return;
    this.clock.clearTimer(this.trailingTimer);
    this.trailingTimer = null;
  }
}

export const onlyPreviewProjectWidthPersistence = new OnlyPreviewProjectWidthPersistenceService(
  resolveBrowserStorage()
);

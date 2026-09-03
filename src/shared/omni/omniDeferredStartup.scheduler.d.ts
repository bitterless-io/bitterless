export const OMNI_DEFERRED_STARTUP_GRACE_MS: number;

export interface OmniDeferredStartupSchedulerOptions {
  delayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function scheduleOmniDeferredStartup(
  callback: () => void,
  options?: OmniDeferredStartupSchedulerOptions,
): () => boolean;

export interface OmniDeferredStartupRegistry {
  schedule(key: number, callback: () => void): boolean;
  cancelAll(): void;
}

export function createOmniDeferredStartupRegistry(
  schedule?: (callback: () => void) => () => boolean,
): OmniDeferredStartupRegistry;

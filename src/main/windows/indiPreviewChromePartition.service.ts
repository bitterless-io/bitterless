const occupiedSlots = new Set<number>();

/** PDF requires persistent sessions. Reuse slots after disposal instead of accumulating random directories. */
export const acquireIndiPreviewChromePartition = (): {
  partition: string;
  release(afterDisposal: Promise<void>): void;
} => {
  let slot = 1;
  while (occupiedSlots.has(slot)) slot += 1;
  occupiedSlots.add(slot);
  let released = false;
  return {
    partition: `persist:indipreview-chrome-${slot}`,
    release(afterDisposal) {
      if (released) return;
      released = true;
      // Failed disposal leaves the slot occupied: never hand a still-live session to another host.
      void afterDisposal.then(() => occupiedSlots.delete(slot), () => undefined);
    }
  };
};

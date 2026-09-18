import { reactive } from 'vue';
import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';

// Coarse on purpose. The index only changes size during a build, and a build is minutes — a footer
// that refreshed every second would cost syscalls continuously to tell nobody anything.
const REFRESH_MS = 30_000;

/**
 * The footer's disk readout: free space on the volume holding `userData`, and what the search
 * indexes occupy on it.
 *
 * These are the two numbers that decided the 2026-09-17 exhaustion — a reconcile needs roughly twice
 * the index size free, and nothing ever evicts — and neither was visible anywhere until the volume
 * was full.
 */
class OnlyPreviewStorageStatusStore {
  freeBytes = 0;
  indexBytes = 0;
  // Before the first successful read there is nothing truthful to show, so the footer shows nothing
  // rather than a pair of zeroes that look like an empty disk.
  loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  async refresh(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    try {
      const status = unwrapOnlyPreviewResult(
        await onlyPreviewClient.getStorageStatus({ hostToken })
      );
      this.freeBytes = status.freeBytes;
      this.indexBytes = status.indexBytes;
      this.loaded = true;
    } catch {
      // Keep the last good pair. A status readout that renders an error is worse than one that
      // quietly holds still — nothing here is actionable in the moment it fails.
    }
  }

  start(): void {
    if (this.timer !== null) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  // A readout, not a monitor: it must not keep a timer alive behind a closed surface.
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

export const onlyPreviewStorageStatus = reactive(new OnlyPreviewStorageStatusStore());

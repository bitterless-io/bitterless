import { app } from 'electron';
import { readdir, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { OnlyPreviewStorageStatus } from '@shared/onlypreview/onlyPreview.types';

// The directory `onlyPreviewSearchBootstrap.registry.ts` writes every workspace's database into.
// Kept as the same two literals rather than imported, because that module builds a full database
// path from a workspace and this one needs the directory with no workspace at all.
const INDEX_DIRECTORY = ['onlypreview', 'search-index-v6'] as const;

// The footer is a readout, not a monitor. The index only changes size during a build, and a build
// takes minutes, so re-walking the directory more often than this buys nothing and costs syscalls on
// every reader that happens to ask.
const CACHE_TTL_MS = 5_000;

/**
 * Free space on the volume holding `userData`, and how much of it the search indexes occupy.
 *
 * Both halves of the pair the 2026-09-17 disk exhaustion turned on: a reconcile needs roughly twice
 * the index size in free space, the caches never evict, and nothing surfaced either number until the
 * volume was full. See [the storage-status feature](../../../docs/features/onlypreview-storage-status.md).
 */
class OnlyPreviewStorageStatusService {
  private cached: { at: number; value: OnlyPreviewStorageStatus } | null = null;
  private inFlight: Promise<OnlyPreviewStorageStatus> | null = null;

  async read(now: number = Date.now()): Promise<OnlyPreviewStorageStatus> {
    if (this.cached && now - this.cached.at < CACHE_TTL_MS) return this.cached.value;
    // Concurrent readers share one walk rather than each starting their own.
    this.inFlight ??= this.measure()
      .then((value) => {
        this.cached = { at: now, value };
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return await this.inFlight;
  }

  private async measure(): Promise<OnlyPreviewStorageStatus> {
    const userDataPath = app.getPath('userData');
    const [freeBytes, indexBytes] = await Promise.all([
      this.freeBytes(userDataPath),
      this.indexBytes(join(userDataPath, ...INDEX_DIRECTORY))
    ]);
    return { freeBytes, indexBytes };
  }

  private async freeBytes(userDataPath: string): Promise<number> {
    const volume = await statfs(userDataPath);
    return Number(volume.bavail) * Number(volume.bsize);
  }

  private async indexBytes(directoryPath: string): Promise<number> {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      // A fresh install has no index directory. That is zero bytes, not a failure.
      return 0;
    }
    let total = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        total += (await stat(join(directoryPath, entry.name))).size;
      } catch {
        // A candidate the build removed between the listing and the stat. Skip it rather than
        // failing the whole reading over a file that is deliberately transient.
      }
    }
    return total;
  }
}

export const onlyPreviewStorageStatusService = new OnlyPreviewStorageStatusService();

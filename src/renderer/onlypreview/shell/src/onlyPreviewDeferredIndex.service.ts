import type { OnlyPreviewSearchDiagnostics } from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

interface DeferredIndexDiagnostic {
  tag: string;
  startedAt: number;
  generation: number;
}

interface DeferredIndexEntry {
  generation: number;
  diagnostic: DeferredIndexDiagnostic;
  isCurrent: () => boolean;
  action: () => void | Promise<void>;
}

// The first index after a restore is kept off the first-paint critical path, but it must still be
// guaranteed to start. A microtask alone is not that guarantee: a shell that is throttled or frozen
// right after `interactive` can leave the queued callback undrained, which showed up in production
// as a restored Project whose path was in the MenuBar and whose tree stayed empty until the owner
// re-opened the folder by hand. `resume()` re-arms the same pending entry from a real user-visible
// signal; whichever path drains first consumes the entry, so the index runs exactly once.
export class OnlyPreviewDeferredIndexService {
  private generation = 0;
  private entry: DeferredIndexEntry | null = null;
  private consumedGeneration = 0;
  private readonly diagnostics: OnlyPreviewSearchDiagnostics;
  private readonly scheduleMicrotask: (run: () => void) => void;

  constructor(
    diagnostics: OnlyPreviewSearchDiagnostics,
    scheduleMicrotask: (run: () => void) => void = (run) => globalThis.queueMicrotask(run)
  ) {
    this.diagnostics = diagnostics;
    this.scheduleMicrotask = scheduleMicrotask;
    // A shell that is throttled or frozen right after `interactive` can leave the queued initial
    // index undrained, which leaves a restored Project with a path and no tree. Both signals fire on
    // the way back to a visible, interactive shell, and `resume()` is idempotent, so re-arming here
    // cannot double-index.
    const resume = (): void => this.resume();
    globalThis.addEventListener?.('focus', resume);
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (globalThis.document?.visibilityState === 'visible') resume();
    });
  }

  async run(
    deferred: boolean,
    isCurrent: () => boolean,
    action: () => void | Promise<void>
  ): Promise<void> {
    if (!deferred) {
      this.cancel();
      await action();
      return;
    }
    this.schedule(isCurrent, action);
  }

  // Safe to call from any trigger and any number of times: it only acts while an entry is still
  // pending, and consuming that entry is what makes it idempotent.
  resume(): void {
    const entry = this.entry;
    if (!entry) return;
    this.drain(entry.generation, 'resumed');
  }

  cancel(): boolean {
    const entry = this.entry;
    if (!entry) return false;
    this.entry = null;
    this.generation += 1;
    this.diagnostics.emit('restore-index-grace', {
      tag: entry.diagnostic.tag,
      phase: 'cancel',
      generation: entry.diagnostic.generation,
      elapsedMs: this.diagnostics.elapsed(entry.diagnostic.startedAt)
    });
    return true;
  }

  private schedule(isCurrent: () => boolean, action: () => void | Promise<void>): void {
    this.cancel();
    const generation = ++this.generation;
    const diagnostic: DeferredIndexDiagnostic = {
      tag: this.diagnostics.nextTag('g'),
      startedAt: this.diagnostics.now(),
      generation
    };
    this.entry = { generation, diagnostic, isCurrent, action };
    this.diagnostics.emit('restore-index-grace', {
      tag: diagnostic.tag,
      phase: 'scheduled',
      generation,
      elapsedMs: 0
    });
    try {
      this.scheduleMicrotask(() => this.drain(generation, 'start'));
    } catch (error) {
      if (this.entry?.generation === generation) this.entry = null;
      this.emitFailure(diagnostic, 'schedule-failure');
      throw error;
    }
  }

  private drain(generation: number, phase: 'start' | 'resumed'): void {
    const entry = this.entry;
    if (!entry || entry.generation !== generation) {
      // Every schedule ends in exactly one terminal record. A generation that already ran through
      // the other trigger is not reported twice; one that was replaced without running is, so a
      // dropped index can never look like a completed one.
      if (this.consumedGeneration !== generation) {
        this.diagnostics.emit('restore-index-grace', {
          tag: `g${generation.toString(36)}`.slice(0, 12),
          phase: 'superseded',
          generation,
          elapsedMs: 0
        });
        this.consumedGeneration = generation;
      }
      return;
    }
    this.entry = null;
    this.consumedGeneration = generation;
    const { diagnostic, isCurrent, action } = entry;
    if (!isCurrent()) {
      this.diagnostics.emit('restore-index-grace', {
        tag: diagnostic.tag,
        phase: 'cancel',
        generation,
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      return;
    }
    this.diagnostics.emit('restore-index-grace', {
      tag: diagnostic.tag,
      phase,
      generation,
      elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
    });
    try {
      const result = action();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => {
          this.emitFailure(diagnostic, 'action-failure');
        });
      }
    } catch {
      this.emitFailure(diagnostic, 'action-failure');
    }
  }

  private emitFailure(
    diagnostic: DeferredIndexDiagnostic,
    phase: 'schedule-failure' | 'action-failure'
  ): void {
    this.diagnostics.emit('restore-index-grace', {
      tag: diagnostic.tag,
      phase,
      generation: diagnostic.generation,
      elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
    });
  }
}

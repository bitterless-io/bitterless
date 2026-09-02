import type { OnlyPreviewSearchDiagnostics } from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

const RESTORED_INDEX_GRACE_MS = 750;

export class OnlyPreviewDeferredIndexService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private diagnostic: { tag: string; startedAt: number; generation: number } | null = null;

  constructor(private readonly diagnostics: OnlyPreviewSearchDiagnostics) {}

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
    this.schedule(isCurrent, () => void action());
  }

  private schedule(isCurrent: () => boolean, run: () => void): void {
    this.cancel();
    const generation = ++this.generation;
    const diagnostic = {
      tag: this.diagnostics.nextTag('g'),
      startedAt: this.diagnostics.now(),
      generation
    };
    this.diagnostic = diagnostic;
    this.diagnostics.emit('restore-index-grace', {
      tag: diagnostic.tag,
      phase: 'scheduled',
      generation,
      elapsedMs: 0
    });
    this.timer = setTimeout(() => {
      if (this.generation !== generation || this.diagnostic !== diagnostic) return;
      this.timer = null;
      this.diagnostic = null;
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
        phase: 'start',
        generation,
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      run();
    }, RESTORED_INDEX_GRACE_MS);
  }

  cancel(): boolean {
    const diagnostic = this.diagnostic;
    if (!this.timer || !diagnostic) return false;
    clearTimeout(this.timer);
    this.timer = null;
    this.diagnostic = null;
    this.generation += 1;
    this.diagnostics.emit('restore-index-grace', {
      tag: diagnostic.tag,
      phase: 'cancel',
      generation: diagnostic.generation,
      elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
    });
    return true;
  }
}

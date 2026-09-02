import type { OnlyPreviewSearchDiagnostics } from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

export class OnlyPreviewDeferredIndexService {
  private pending = false;
  private generation = 0;
  private diagnostic: { tag: string; startedAt: number; generation: number } | null = null;

  constructor(
    private readonly diagnostics: OnlyPreviewSearchDiagnostics,
    private readonly scheduleMicrotask: (run: () => void) => void = queueMicrotask
  ) {}

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
    this.pending = true;
    this.diagnostics.emit('restore-index-grace', {
      tag: diagnostic.tag,
      phase: 'scheduled',
      generation,
      elapsedMs: 0
    });
    this.scheduleMicrotask(() => {
      if (this.generation !== generation || this.diagnostic !== diagnostic) return;
      this.pending = false;
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
    });
  }

  cancel(): boolean {
    const diagnostic = this.diagnostic;
    if (!this.pending || !diagnostic) return false;
    this.pending = false;
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

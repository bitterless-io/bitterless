// Filesystem watching for the Submodules mini app. Every target is best-effort: a repository can
// be deleted or re-created while it is watched, and one dead watcher must never stop the others.
import { watch, type FSWatcher } from 'node:fs';
import type { SubmoduleWatchTarget } from './submoduleScanner.service';

const describeTargets = (targets: readonly SubmoduleWatchTarget[]): string =>
  targets.map((target) => `${target.recursive ? 'r' : 'f'}:${target.path}`).join('\n');

export class SubmoduleWatcher {
  private watchers: FSWatcher[] = [];
  private signature = '';
  private readonly onChange: () => void;

  constructor(options: { onChange: () => void }) {
    this.onChange = options.onChange;
  }

  get active(): boolean {
    return this.watchers.length > 0;
  }

  /** Re-arming is skipped when the target set is unchanged, so a safety rescan costs nothing. */
  retarget(targets: readonly SubmoduleWatchTarget[]): void {
    const signature = describeTargets(targets);
    if (signature === this.signature && (this.active || !targets.length)) return;
    this.close();
    this.signature = signature;
    for (const target of targets) {
      try {
        const watcher = watch(target.path, { persistent: false, recursive: target.recursive }, () =>
          this.onChange()
        );
        watcher.on('error', () => undefined);
        this.watchers.push(watcher);
      } catch {
        // A target that cannot be watched is covered by the interval rescan.
      }
    }
  }

  close(): void {
    this.signature = '';
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Already closed by the OS.
      }
    }
    this.watchers = [];
  }
}

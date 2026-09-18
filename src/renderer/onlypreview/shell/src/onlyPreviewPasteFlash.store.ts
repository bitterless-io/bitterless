import { reactive } from 'vue';

// One pass of the flash. Kept here rather than read back from the stylesheet so the class is removed
// even when the animation never runs — a row scrolled out of the DOM fires no `animationend`, and a
// path stuck in the set would keep re-flashing on every later render.
const FLASH_MS = 900;

/**
 * The one-shot background flash on a freshly pasted row.
 *
 * Owner, 2026-09-18: 「背景色闪烁一下：无背景色-变蓝-变成无背景色，但是不用打开预览哦」 — the row has
 * to announce itself without the preview changing, so this is deliberately *only* a class on the
 * row. It sets no selection and opens nothing.
 *
 * Paths, not elements: the tree re-renders rows freely, so the flag has to survive a re-render and
 * be asked for by path at paint time.
 */
class OnlyPreviewPasteFlashStore {
  paths = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  isFlashing(relativePath: string): boolean {
    return this.paths.has(relativePath);
  }

  flash(relativePaths: readonly string[]): void {
    for (const relativePath of relativePaths) {
      if (!relativePath) continue;
      // Re-pasting the same path restarts its flash rather than being swallowed by the running one.
      this.clearTimer(relativePath);
      this.paths.delete(relativePath);
      this.paths.add(relativePath);
      this.timers.set(
        relativePath,
        setTimeout(() => {
          this.paths.delete(relativePath);
          this.timers.delete(relativePath);
        }, FLASH_MS)
      );
    }
  }

  // Opening another workspace replaces every row, so a pending flash has nothing left to land on.
  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.paths.clear();
  }

  private clearTimer(relativePath: string): void {
    const timer = this.timers.get(relativePath);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(relativePath);
  }
}

export const onlyPreviewPasteFlash = reactive(new OnlyPreviewPasteFlashStore());

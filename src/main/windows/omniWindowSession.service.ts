import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Omni open intent is independent of geometry, including legacy geometry-only entries. */
export class OmniWindowSessionService {
  private open: boolean | null = null;
  private restoreAttempted = false;
  private readonly getFilePath: () => string;

  constructor(getFilePath: () => string) {
    this.getFilePath = getFilePath;
  }

  isOpen(): boolean {
    if (this.open !== null) return this.open;
    try {
      const saved: unknown = JSON.parse(readFileSync(this.getFilePath(), 'utf8'));
      this.open = Boolean(
        saved && typeof saved === 'object' && !Array.isArray(saved) &&
        (saved as { open?: unknown }).open === true,
      );
    } catch {
      this.open = false;
    }
    return this.open;
  }

  setOpen(open: boolean): void {
    if (this.isOpen() === open) return;
    const filePath = this.getFilePath();
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      writeFileSync(temporaryPath, `${JSON.stringify({ open })}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporaryPath, filePath);
      this.open = open;
    } catch (error) {
      console.error('[OmniWindowSession] Failed to save open state:', error);
      try { rmSync(temporaryPath, { force: true }); } catch {
        // Preserve the existing state file if temporary-file cleanup also fails.
      }
    }
  }

  async restoreOnce(openWindow: () => Promise<unknown>): Promise<void> {
    if (this.restoreAttempted) return;
    this.restoreAttempted = true;
    if (this.isOpen()) await openWindow();
  }
}

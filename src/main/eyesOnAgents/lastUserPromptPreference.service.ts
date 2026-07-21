import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  unlinkSync
} from 'node:fs';
import { dirname, join } from 'node:path';

const isMissingPathError = (error: unknown): boolean => {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
};

const isExistingPathError = (error: unknown): boolean => {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
};

export class LastUserPromptPreferenceService {
  private readonly markerPath: string;

  constructor(userDataPath: string) {
    this.markerPath = join(
      userDataPath,
      'eyes-on-agents',
      'last-user-prompt.enabled'
    );
  }

  isEnabled(): boolean {
    try {
      return lstatSync(this.markerPath).isFile();
    } catch (error) {
      if (isMissingPathError(error)) return false;
      throw error;
    }
  }

  enable(): boolean {
    if (this.isEnabled()) return false;
    mkdirSync(dirname(this.markerPath), { recursive: true, mode: 0o700 });
    let descriptor: number;
    try {
      descriptor = openSync(this.markerPath, 'wx', 0o600);
    } catch (error) {
      if (isExistingPathError(error) && this.isEnabled()) return false;
      throw error;
    }
    closeSync(descriptor);
    return true;
  }

  disable(): boolean {
    try {
      unlinkSync(this.markerPath);
      return true;
    } catch (error) {
      if (isMissingPathError(error)) return false;
      throw error;
    }
  }
}

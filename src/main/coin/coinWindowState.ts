import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

export const COIN_WINDOW_MIN_WIDTH = 800;
export const COIN_WINDOW_MIN_HEIGHT = 600;
export const COIN_WINDOW_DEFAULT_WIDTH = 1360;
export const COIN_WINDOW_DEFAULT_HEIGHT = 860;

const MAX_WINDOW_DIMENSION = 16_384;
const MIN_VISIBLE_WIDTH = 80;
const MIN_VISIBLE_HEIGHT = 40;

export interface CoinWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoinDisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoinPersistedWindowState {
  version: 1;
  bounds: CoinWindowBounds;
  maximized: boolean;
}

const toFiniteInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
};

export const parseCoinWindowBounds = (value: unknown): CoinWindowBounds | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const x = toFiniteInteger(candidate.x);
  const y = toFiniteInteger(candidate.y);
  const width = toFiniteInteger(candidate.width);
  const height = toFiniteInteger(candidate.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (
    width < COIN_WINDOW_MIN_WIDTH ||
    height < COIN_WINDOW_MIN_HEIGHT ||
    width > MAX_WINDOW_DIMENSION ||
    height > MAX_WINDOW_DIMENSION
  ) {
    return null;
  }
  return { x, y, width, height };
};

export const parseCoinWindowState = (value: unknown): CoinPersistedWindowState | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.maximized !== 'boolean') return null;
  const bounds = parseCoinWindowBounds(candidate.bounds);
  if (!bounds) return null;
  return { version: 1, bounds, maximized: candidate.maximized };
};

const overlap = (
  firstStart: number,
  firstLength: number,
  secondStart: number,
  secondLength: number,
): number =>
  Math.min(firstStart + firstLength, secondStart + secondLength) -
  Math.max(firstStart, secondStart);

export const isCoinWindowVisible = (
  bounds: CoinWindowBounds,
  displays: CoinDisplayBounds[],
): boolean =>
  displays.some(
    (display) =>
      overlap(bounds.x, bounds.width, display.x, display.width) >= MIN_VISIBLE_WIDTH &&
      overlap(bounds.y, bounds.height, display.y, display.height) >= MIN_VISIBLE_HEIGHT,
  );

export const restoreCoinWindowState = (
  value: unknown,
  displays: CoinDisplayBounds[],
): CoinPersistedWindowState | null => {
  const state = parseCoinWindowState(value);
  if (!state || !isCoinWindowVisible(state.bounds, displays)) return null;
  return state;
};

export class CoinWindowStateStore {
  readonly filePath: string;

  constructor(userDataDirectory: string) {
    this.filePath = join(userDataDirectory, 'coin', 'window-state.json');
  }

  read(displays: CoinDisplayBounds[]): CoinPersistedWindowState | null {
    if (!existsSync(this.filePath)) return null;
    try {
      return restoreCoinWindowState(
        JSON.parse(readFileSync(this.filePath, 'utf8')),
        displays,
      );
    } catch {
      return null;
    }
  }

  readLegacy(): CoinPersistedWindowState | null {
    if (!existsSync(this.filePath)) return null;
    try {
      return parseCoinWindowState(JSON.parse(readFileSync(this.filePath, 'utf8')));
    } catch {
      return null;
    }
  }

  save(state: CoinPersistedWindowState, displays: CoinDisplayBounds[]): boolean {
    const validated = restoreCoinWindowState(state, displays);
    if (!validated) return false;

    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
      writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporaryPath, this.filePath);
      if (process.platform !== 'win32') chmodSync(this.filePath, 0o600);
      return true;
    } catch {
      rmSync(temporaryPath, { force: true });
      return false;
    }
  }
}

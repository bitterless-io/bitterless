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
import { app, screen, type BaseWindow, type Rectangle } from 'electron';
import type {
  WindowBounds,
  WindowLayout,
  WindowStateKey,
} from '@shared/window/window.types';
import {
  applyE2EWindowPlacement,
  resolveE2EWindowPlacement,
  showWindowWithE2EPlacement,
  type E2EWindowPlacement,
} from './e2eWindowPlacement.service';

const WINDOW_STATE_FILE = 'window-state.json';
const DEFAULT_MIN_WIDTH = 800;
const DEFAULT_MIN_HEIGHT = 600;
const MAX_WINDOW_DIMENSION = 16_384;
const MAX_ABSOLUTE_COORDINATE = 1_000_000;
const MIN_VISIBLE_WIDTH = 80;
const MIN_VISIBLE_HEIGHT = 40;
const SAVE_DELAY_MS = 300;

export interface WindowRestoreOptions {
  minWidth?: number;
  minHeight?: number;
}

export interface WindowRegistrationOptions extends WindowRestoreOptions {
  deferInitialSave?: boolean;
}

const resolveE2EPlacementForWindow = (
  window: BaseWindow,
  options: WindowRestoreOptions = {},
): E2EWindowPlacement | null => {
  const isE2E = process.env.BITTERLESS_E2E === '1';
  const targetDisplayLabel = process.env.BITTERLESS_E2E_DISPLAY_LABEL;
  return resolveE2EWindowPlacement({
    isE2E,
    targetDisplayLabel,
    displays: isE2E && targetDisplayLabel ? screen.getAllDisplays() : [],
    windowBounds: window.getNormalBounds(),
    minWidth: options.minWidth,
    minHeight: options.minHeight,
  });
};

const installE2EBrowserWindowPlacement = (): void => {
  if (
    process.env.BITTERLESS_E2E !== '1' ||
    !process.env.BITTERLESS_E2E_DISPLAY_LABEL
  ) {
    return;
  }
  app.on('browser-window-created', (_event, window) => {
    const applyPlacement = (): void => {
      const placement = resolveE2EPlacementForWindow(window);
      if (placement) applyE2EWindowPlacement(window, placement);
    };
    applyPlacement();
    window.once('ready-to-show', applyPlacement);
  });
};

export interface ResolvedWindowState {
  bounds: WindowBounds;
  maximized: boolean;
  fullScreen: boolean;
}

export interface WindowDisplayGeometry {
  id: number;
  workArea: WindowBounds;
}

const toFiniteInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
};

const parseDisplayId = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

const parseRectangle = (value: unknown): WindowBounds | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const x = toFiniteInteger(candidate.x);
  const y = toFiniteInteger(candidate.y);
  const width = toFiniteInteger(candidate.width);
  const height = toFiniteInteger(candidate.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (Math.abs(x) > MAX_ABSOLUTE_COORDINATE || Math.abs(y) > MAX_ABSOLUTE_COORDINATE) {
    return null;
  }
  if (width <= 0 || height <= 0 || width > MAX_WINDOW_DIMENSION || height > MAX_WINDOW_DIMENSION) {
    return null;
  }
  return { x, y, width, height };
};

const parseBounds = (value: unknown): WindowBounds | null => {
  const bounds = parseRectangle(value);
  if (
    !bounds ||
    bounds.width < DEFAULT_MIN_WIDTH ||
    bounds.height < DEFAULT_MIN_HEIGHT
  ) {
    return null;
  }
  return bounds;
};

export const parseWindowLayout = (value: unknown): WindowLayout | null => {
  const bounds = parseBounds(value);
  if (!bounds || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.maximized !== undefined && typeof candidate.maximized !== 'boolean') ||
    (candidate.fullScreen !== undefined && typeof candidate.fullScreen !== 'boolean')
  ) {
    return null;
  }
  const displayWorkArea = candidate.displayWorkArea
    ? parseRectangle(candidate.displayWorkArea)
    : null;
  if (candidate.displayWorkArea !== undefined && !displayWorkArea) return null;
  const displayId = parseDisplayId(candidate.displayId);
  if (candidate.displayId !== undefined && displayId === null) return null;
  const relativeXValue = candidate.relativeX ?? candidate.relX;
  const relativeYValue = candidate.relativeY ?? candidate.relY;
  const relativeX = toFiniteInteger(relativeXValue);
  const relativeY = toFiniteInteger(relativeYValue);
  if (
    (relativeXValue !== undefined && (
      relativeX === null || Math.abs(relativeX) > MAX_ABSOLUTE_COORDINATE
    )) ||
    (relativeYValue !== undefined && (
      relativeY === null || Math.abs(relativeY) > MAX_ABSOLUTE_COORDINATE
    ))
  ) {
    return null;
  }
  return {
    ...bounds,
    ...(candidate.maximized === true ? { maximized: true } : {}),
    ...(candidate.fullScreen === true ? { fullScreen: true } : {}),
    ...(displayId !== null && displayId >= 0 ? { displayId } : {}),
    ...(displayWorkArea ? { displayWorkArea } : {}),
    ...(relativeX !== null ? { relativeX } : {}),
    ...(relativeY !== null ? { relativeY } : {}),
  };
};

const overlap = (
  firstStart: number,
  firstLength: number,
  secondStart: number,
  secondLength: number,
): number =>
  Math.min(firstStart + firstLength, secondStart + secondLength) -
  Math.max(firstStart, secondStart);

const isVisibleOnDisplay = (
  bounds: WindowBounds,
  display: WindowDisplayGeometry,
): boolean =>
  overlap(bounds.x, bounds.width, display.workArea.x, display.workArea.width) >=
    MIN_VISIBLE_WIDTH &&
  overlap(bounds.y, bounds.height, display.workArea.y, display.workArea.height) >=
    MIN_VISIBLE_HEIGHT;

const sameBounds = (first: WindowBounds, second: Rectangle): boolean =>
  first.x === second.x &&
  first.y === second.y &&
  first.width === second.width &&
  first.height === second.height;

const sameWindowLayout = (
  first: WindowLayout | null,
  second: WindowLayout | null,
): boolean => {
  if (!first || !second) return first === second;
  return JSON.stringify(parseWindowLayout(first)) === JSON.stringify(parseWindowLayout(second));
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const constrainSize = (
  saved: WindowBounds,
  workArea: Rectangle,
  options: WindowRestoreOptions,
): { width: number; height: number } => {
  const minWidth = options.minWidth ?? DEFAULT_MIN_WIDTH;
  const minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
  return {
    width: Math.max(minWidth, Math.min(saved.width, Math.max(workArea.width, minWidth))),
    height: Math.max(minHeight, Math.min(saved.height, Math.max(workArea.height, minHeight))),
  };
};

const clampPosition = (
  position: { x: number; y: number },
  size: { width: number; height: number },
  workArea: Rectangle,
): { x: number; y: number } => ({
  x: clamp(
    position.x,
    workArea.x,
    workArea.x + Math.max(0, workArea.width - size.width),
  ),
  y: clamp(
    position.y,
    workArea.y,
    workArea.y + Math.max(0, workArea.height - size.height),
  ),
});

const findWorkAreaMatch = (
  savedWorkArea: WindowBounds | undefined,
  displays: WindowDisplayGeometry[],
): WindowDisplayGeometry | null => {
  if (!savedWorkArea) return null;
  return displays.find((display) => sameBounds(savedWorkArea, display.workArea)) ?? null;
};

export const resolveWindowStateForDisplays = (
  value: unknown,
  displays: WindowDisplayGeometry[],
  primaryDisplay: WindowDisplayGeometry,
  options: WindowRestoreOptions = {},
): ResolvedWindowState | null => {
  const saved = parseWindowLayout(value);
  if (!saved) return null;
  if (!displays.length) return null;

  const savedBounds: WindowBounds = {
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
  };
  let target = saved.displayId !== undefined
    ? displays.find((display) => display.id === saved.displayId) ?? null
    : null;
  let useAbsolutePosition = false;

  if (!target) target = findWorkAreaMatch(saved.displayWorkArea, displays);
  if (!target) {
    target = displays.find((display) => isVisibleOnDisplay(savedBounds, display)) ?? null;
    useAbsolutePosition = Boolean(target);
  }
  if (!target) target = primaryDisplay;

  const size = constrainSize(savedBounds, target.workArea, options);
  const relativeX = saved.relativeX ??
    saved.x - (saved.displayWorkArea?.x ?? target.workArea.x);
  const relativeY = saved.relativeY ??
    saved.y - (saved.displayWorkArea?.y ?? target.workArea.y);
  const desiredPosition = useAbsolutePosition
    ? { x: saved.x, y: saved.y }
    : {
        x: target.workArea.x + relativeX,
        y: target.workArea.y + relativeY,
      };
  const position = clampPosition(desiredPosition, size, target.workArea);

  return {
    bounds: { ...position, ...size },
    maximized: saved.maximized === true,
    fullScreen: saved.fullScreen === true,
  };
};

export const resolveWindowState = (
  value: unknown,
  options: WindowRestoreOptions = {},
): ResolvedWindowState | null => {
  const displays = screen.getAllDisplays();
  if (!displays.length) return null;
  return resolveWindowStateForDisplays(
    value,
    displays,
    screen.getPrimaryDisplay(),
    options,
  );
};

export const captureWindowState = (window: BaseWindow): WindowLayout | null => {
  if (window.isDestroyed()) return null;
  try {
    const bounds = window.getNormalBounds();
    if (!parseBounds(bounds)) return null;
    const display = screen.getDisplayMatching(bounds);
    const displayId = Number.isSafeInteger(display.id) && display.id >= 0
      ? display.id
      : undefined;
    return {
      ...bounds,
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
      ...(displayId !== undefined ? { displayId } : {}),
      displayWorkArea: { ...display.workArea },
      relativeX: bounds.x - display.workArea.x,
      relativeY: bounds.y - display.workArea.y,
    };
  } catch {
    return null;
  }
};

class WindowStateStore {
  private state: Partial<Record<WindowStateKey, WindowLayout>> | null = null;

  has(key: WindowStateKey): boolean {
    return this.read(key) !== null;
  }

  read(key: WindowStateKey): WindowLayout | null {
    return parseWindowLayout(this.readAll()[key]);
  }

  save(key: WindowStateKey, value: WindowLayout): boolean {
    const normalized = parseWindowLayout(value);
    if (!normalized) return false;
    const current = this.read(key);
    if (current && JSON.stringify(current) === JSON.stringify(normalized)) return false;
    const next = { ...this.readAll(), [key]: normalized };
    const filePath = this.filePath();
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporaryPath, filePath);
      if (process.platform !== 'win32') chmodSync(filePath, 0o600);
      this.state = next;
      return true;
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      console.error('[WindowStateStore] Failed to save window state:', error);
      return false;
    }
  }

  private filePath(): string {
    return join(app.getPath('userData'), WINDOW_STATE_FILE);
  }

  private readAll(): Partial<Record<WindowStateKey, WindowLayout>> {
    if (this.state) return this.state;
    const filePath = this.filePath();
    if (!existsSync(filePath)) {
      this.state = {};
      return this.state;
    }
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      this.state = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Partial<Record<WindowStateKey, WindowLayout>>
        : {};
    } catch {
      this.state = {};
    }
    return this.state;
  }
}

export class WindowStateController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private applyingRestore = false;
  private restored: ResolvedWindowState | null;
  private readonly e2ePlacement: E2EWindowPlacement | null;
  private restoreApplied = false;
  private localChange = false;
  private persistenceEnabled: boolean;
  private lastObserved: WindowLayout | null;

  constructor(
    private readonly service: WindowStateService,
    readonly key: WindowStateKey,
    readonly window: BaseWindow,
    private readonly options: WindowRegistrationOptions,
  ) {
    this.e2ePlacement = resolveE2EPlacementForWindow(window, options);
    this.restored = this.e2ePlacement ?? this.service.resolve(key, options);
    this.persistenceEnabled = !options.deferInitialSave || this.service.has(key);
    this.lastObserved = captureWindowState(window);
    window.on('move', this.schedule);
    window.on('resize', this.schedule);
    window.on('maximize', this.schedule);
    window.on('unmaximize', this.handleReturnToNormal);
    window.on('enter-full-screen', this.schedule);
    window.on('leave-full-screen', this.handleReturnToNormal);
    window.on('close', this.flush);
    window.once('closed', this.dispose);
  }

  importLegacy(value: unknown): boolean {
    if (this.e2ePlacement || this.localChange || this.service.has(this.key)) return false;
    const imported = this.service.importLegacy(this.key, value, this.options);
    if (!imported || this.window.isDestroyed()) return false;
    this.persistenceEnabled = true;
    this.restored = imported;
    this.applyBounds();
    return true;
  }

  enablePersistence(): void {
    this.persistenceEnabled = true;
  }

  show(): void {
    if (this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    if (!this.restoreApplied) {
      if (this.e2ePlacement) {
        showWindowWithE2EPlacement(this.window, this.e2ePlacement);
        this.lastObserved = captureWindowState(this.window);
      } else {
        this.applyBounds();
        if (this.restored?.fullScreen) {
          this.window.show();
          this.window.setFullScreen(true);
        } else {
          if (this.restored?.maximized) this.window.maximize();
          this.window.show();
        }
      }
      this.restoreApplied = true;
      return;
    }
    this.window.show();
  }

  flush = (): void => {
    this.clearTimer();
    if (!this.persistenceEnabled || this.disposed || this.window.isDestroyed()) return;
    const state = captureWindowState(this.window);
    if (state) {
      this.lastObserved = state;
      this.service.save(this.key, state);
    }
  };

  flushAndDispose(): void {
    this.flush();
    this.dispose();
  }

  ensureVisible(): void {
    if (
      this.disposed ||
      this.window.isDestroyed() ||
      this.window.isMaximized() ||
      this.window.isFullScreen()
    ) {
      return;
    }
    const resolved = resolveWindowState(this.lastObserved, this.options) ??
      this.service.resolve(this.key, this.options);
    if (!resolved) return;
    const bounds = this.window.getBounds();
    if (sameBounds(resolved.bounds, bounds)) return;
    this.restored = resolved;
    this.applyingRestore = true;
    try {
      this.window.setBounds(resolved.bounds);
    } finally {
      this.applyingRestore = false;
    }
    this.flush();
  }

  private schedule = (): void => {
    if (this.disposed || this.applyingRestore) return;
    const current = captureWindowState(this.window);
    if (sameWindowLayout(current, this.lastObserved)) return;
    this.lastObserved = current;
    this.localChange = true;
    this.persistenceEnabled = true;
    this.clearTimer();
    this.timer = setTimeout(this.flush, SAVE_DELAY_MS);
  };

  private handleReturnToNormal = (): void => {
    if (this.disposed || this.applyingRestore) return;
    this.localChange = true;
    this.ensureVisible();
    this.schedule();
  };

  private applyBounds(): void {
    if (!this.restored || this.window.isDestroyed()) return;
    this.applyingRestore = true;
    try {
      this.window.setBounds(this.restored.bounds);
    } finally {
      this.applyingRestore = false;
    }
    this.lastObserved = captureWindowState(this.window);
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private dispose = (): void => {
    if (this.disposed) return;
    this.clearTimer();
    this.disposed = true;
    this.window.removeListener('move', this.schedule);
    this.window.removeListener('resize', this.schedule);
    this.window.removeListener('maximize', this.schedule);
    this.window.removeListener('unmaximize', this.handleReturnToNormal);
    this.window.removeListener('enter-full-screen', this.schedule);
    this.window.removeListener('leave-full-screen', this.handleReturnToNormal);
    this.window.removeListener('close', this.flush);
    this.service.unregister(this);
  };
}

class WindowStateService {
  private readonly store = new WindowStateStore();
  private readonly controllers = new Set<WindowStateController>();
  private displayListenersInstalled = false;

  has(key: WindowStateKey): boolean {
    return this.store.has(key);
  }

  resolve(
    key: WindowStateKey,
    options: WindowRestoreOptions = {},
  ): ResolvedWindowState | null {
    return resolveWindowState(this.store.read(key), options);
  }

  save(key: WindowStateKey, state: WindowLayout): boolean {
    return this.store.save(key, state);
  }

  importLegacy(
    key: WindowStateKey,
    value: unknown,
    options: WindowRestoreOptions = {},
  ): ResolvedWindowState | null {
    if (this.has(key)) return this.resolve(key, options);
    const resolved = resolveWindowState(value, options);
    if (!resolved) return null;
    const display = screen.getDisplayMatching(resolved.bounds);
    const migrated: WindowLayout = {
      ...resolved.bounds,
      maximized: resolved.maximized,
      fullScreen: resolved.fullScreen,
      ...(Number.isSafeInteger(display.id) && display.id >= 0
        ? { displayId: display.id }
        : {}),
      displayWorkArea: { ...display.workArea },
      relativeX: resolved.bounds.x - display.workArea.x,
      relativeY: resolved.bounds.y - display.workArea.y,
    };
    this.save(key, migrated);
    return resolveWindowState(migrated, options);
  }

  register(
    key: WindowStateKey,
    window: BaseWindow,
    options: WindowRegistrationOptions = {},
  ): WindowStateController {
    this.installDisplayListeners();
    const controller = new WindowStateController(this, key, window, options);
    this.controllers.add(controller);
    return controller;
  }

  unregister(controller: WindowStateController): void {
    this.controllers.delete(controller);
  }

  private installDisplayListeners(): void {
    if (this.displayListenersInstalled) return;
    this.displayListenersInstalled = true;
    screen.on('display-removed', this.ensureRegisteredWindowsVisible);
    screen.on('display-metrics-changed', (_event, _display, changedMetrics) => {
      if (
        changedMetrics.includes('bounds') ||
        changedMetrics.includes('workArea') ||
        changedMetrics.includes('scaleFactor')
      ) {
        this.ensureRegisteredWindowsVisible();
      }
    });
  }

  private ensureRegisteredWindowsVisible = (): void => {
    for (const controller of this.controllers) controller.ensureVisible();
  };
}

installE2EBrowserWindowPlacement();
export const windowStateService = new WindowStateService();

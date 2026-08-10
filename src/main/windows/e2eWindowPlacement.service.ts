export interface E2EWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface E2EDisplayGeometry {
  label: string;
  workArea: E2EWindowBounds;
}

export interface E2EWindowPlacement {
  bounds: E2EWindowBounds;
  maximized: false;
  fullScreen: false;
}

export interface E2EWindowPlacementRequest {
  isE2E: boolean;
  targetDisplayLabel?: string;
  displays: readonly E2EDisplayGeometry[];
  windowBounds: E2EWindowBounds;
  minWidth?: number;
  minHeight?: number;
}

export interface E2EPlacementWindow {
  isFullScreen(): boolean;
  setFullScreen(fullScreen: boolean): void;
  isMaximized(): boolean;
  unmaximize(): void;
  setBounds(bounds: E2EWindowBounds): void;
  show(): void;
}

const DEFAULT_MIN_WIDTH = 800;
const DEFAULT_MIN_HEIGHT = 600;

export class E2ETargetDisplayResolutionError extends Error {
  constructor(targetDisplayLabel: string, availableDisplayLabels: readonly string[]) {
    const available = availableDisplayLabels.length
      ? availableDisplayLabels.map((label) => JSON.stringify(label)).join(', ')
      : '(none)';
    super(
      `E2E target display ${JSON.stringify(targetDisplayLabel)} must match exactly one display. ` +
        `Available display labels: ${available}`
    );
    this.name = 'E2ETargetDisplayResolutionError';
  }
}

const constrainDimension = (current: number, minimum: number, workAreaDimension: number): number =>
  Math.max(minimum, Math.min(current, Math.max(workAreaDimension, minimum)));

export const resolveE2EWindowPlacement = ({
  isE2E,
  targetDisplayLabel,
  displays,
  windowBounds,
  minWidth = DEFAULT_MIN_WIDTH,
  minHeight = DEFAULT_MIN_HEIGHT
}: E2EWindowPlacementRequest): E2EWindowPlacement | null => {
  if (!isE2E || !targetDisplayLabel) return null;

  const matches = displays.filter((display) => display.label === targetDisplayLabel);
  if (matches.length !== 1) {
    throw new E2ETargetDisplayResolutionError(
      targetDisplayLabel,
      displays.map((display) => display.label)
    );
  }

  const workArea = matches[0].workArea;
  const width = constrainDimension(windowBounds.width, minWidth, workArea.width);
  const height = constrainDimension(windowBounds.height, minHeight, workArea.height);
  const availableX = Math.max(0, workArea.width - width);
  const availableY = Math.max(0, workArea.height - height);

  return {
    bounds: {
      x: workArea.x + Math.floor(availableX / 2),
      y: workArea.y + Math.floor(availableY / 2),
      width,
      height
    },
    maximized: false,
    fullScreen: false
  };
};

export const applyE2EWindowPlacement = (
  window: E2EPlacementWindow,
  placement: E2EWindowPlacement
): void => {
  if (window.isFullScreen()) window.setFullScreen(false);
  if (window.isMaximized()) window.unmaximize();
  window.setBounds(placement.bounds);
};

export const showWindowWithE2EPlacement = (
  window: E2EPlacementWindow,
  placement: E2EWindowPlacement
): void => {
  applyE2EWindowPlacement(window, placement);
  window.show();
};

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized?: boolean;
  fullScreen?: boolean;
  displayId?: number;
  displayWorkArea?: WindowBounds;
  relativeX?: number;
  relativeY?: number;
}

export type WindowStateKey =
  | 'main'
  | 'todo'
  | 'omni'
  | 'eyes-on-agents'
  | 'maestro'
  | 'coin'
  | 'plugin-content'
  | 'plugin-options';
